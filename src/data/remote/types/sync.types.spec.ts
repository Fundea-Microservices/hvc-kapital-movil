import {
  banderaDe,
  esFilaServidor,
  mensajeDeError,
  numeroDe,
  obtenerCambiosTabla,
  textoDe,
} from './sync.types';

/**
 * Estas funciones son la frontera con el servidor. Casi todos los fallos de
 * sincronización del proyecto entraron por aquí: un alias de columna que no se
 * contemplaba, un bloque de deltas que se ignoraba, un valor nulo que se leía como
 * texto. Son puras, así que probarlas cuesta muy poco y cubre mucho.
 */

describe('textoDe — alias de columna', () => {
  it('acepta las tres convenciones de nombre del backend', () => {
    // El BackOffice y la BD legada no coinciden en casing. Un alias faltante deja el
    // campo en null CON UN BACKEND PERFECTAMENTE SANO, y se diagnostica fatal porque
    // todo "parece" bien.
    expect(textoDe({ mi_campo: 'a' }, 'mi_campo', 'miCampo', 'MiCampo')).toBe('a');
    expect(textoDe({ miCampo: 'b' }, 'mi_campo', 'miCampo', 'MiCampo')).toBe('b');
    expect(textoDe({ MiCampo: 'c' }, 'mi_campo', 'miCampo', 'MiCampo')).toBe('c');
  });

  it('respeta el orden de prioridad de los alias', () => {
    expect(textoDe({ a: '1', b: '2' }, 'a', 'b')).toBe('1');
  });

  it('devuelve null cuando ningun alias existe', () => {
    expect(textoDe({ otro: 'x' }, 'mi_campo')).toBeNull();
  });

  it('null y undefined NO se convierten en la cadena "null"', () => {
    expect(textoDe({ campo: null }, 'campo')).toBeNull();
    expect(textoDe({ campo: undefined }, 'campo')).toBeNull();
  });
});

describe('numeroDe y banderaDe', () => {
  it('numeroDe cae al valor por defecto ante basura', () => {
    expect(numeroDe({ n: '42' }, 0, 'n')).toBe(42);
    expect(numeroDe({ n: 'abc' }, 7, 'n')).toBe(7);
    expect(numeroDe({}, 7, 'n')).toBe(7);
  });

  it('banderaDe normaliza las variantes de verdadero que manda SQL Server', () => {
    // BIT llega como 1, como '1' o como true segun el driver y la consulta.
    [1, '1', true].forEach(v => expect(banderaDe({ f: v }, 'f')).toBe(1));
    [0, '0', false, null, undefined, 'x'].forEach(v => expect(banderaDe({ f: v }, 'f')).toBe(0));
  });
});

describe('obtenerCambiosTabla — los tres grupos de deltas', () => {
  it('aplica created, updated Y deleted', () => {
    // El bug del menu congelado: la app solo leia `created`. El servidor manda todo
    // por `updated`/`deleted` en cuanto metadata_sync tiene fecha previa, asi que el
    // menu dejaba de actualizarse por completo.
    const respuesta = {
      cat_menu_appex: {
        created: [{ id: 1 }],
        updated: [{ id: 2 }],
        deleted: ['3', 4],
      },
    };
    const cambios = obtenerCambiosTabla(respuesta, 'cat_menu_appex');

    expect(cambios.created).toHaveLength(1);
    expect(cambios.updated).toHaveLength(1);
    expect(cambios.deleted).toEqual(['3', '4']);
  });

  it('acepta alias del nombre de la tabla', () => {
    const respuesta = { CatMenuAppEx: { created: [{ id: 1 }], updated: [], deleted: [] } };
    expect(obtenerCambiosTabla(respuesta, 'cat_menu_appex', 'CatMenuAppEx').created).toHaveLength(1);
  });

  it('una tabla ausente devuelve los tres grupos VACIOS, no undefined', () => {
    // Devolver undefined aqui provocaba un TypeError que abortaba la sincronizacion
    // COMPLETA, no solo esa tabla.
    const cambios = obtenerCambiosTabla({}, 'tabla_que_no_vino');
    expect(cambios).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('tolera que el servidor mande basura en lugar de arreglos', () => {
    const cambios = obtenerCambiosTabla(
      { t: { created: 'no soy un arreglo', updated: null, deleted: 5 } },
      't',
    );
    expect(cambios).toEqual({ created: [], updated: [], deleted: [] });
  });

  it('descarta las filas que no son objetos', () => {
    const cambios = obtenerCambiosTabla({ t: { created: [{ id: 1 }, 'basura', null] } }, 't');
    expect(cambios.created).toHaveLength(1);
  });

  it('no revienta si la respuesta entera es null o un tipo inesperado', () => {
    [null, undefined, 'texto', 42].forEach(origen => {
      expect(obtenerCambiosTabla(origen, 't')).toEqual({ created: [], updated: [], deleted: [] });
    });
  });
});

describe('mensajeDeError', () => {
  it('prefiere el mensaje del servidor cuando existe', () => {
    const error = { response: { data: { message: 'Device Blocked' } } };
    expect(mensajeDeError(error, 'generico')).toBe('Device Blocked');
  });

  it('cae al mensaje del Error, y luego al valor por defecto', () => {
    expect(mensajeDeError(new Error('sin red'), 'generico')).toBe('sin red');
    expect(mensajeDeError({}, 'generico')).toBe('generico');
    expect(mensajeDeError(new Error('   '), 'generico')).toBe('generico');
  });
});

describe('esFilaServidor', () => {
  it('distingue objetos de arreglos y primitivos', () => {
    expect(esFilaServidor({ a: 1 })).toBe(true);
    expect(esFilaServidor([])).toBe(false);
    expect(esFilaServidor(null)).toBe(false);
    expect(esFilaServidor('x')).toBe(false);
  });
});

describe('el idCaptura del /submit NUNCA se inventa', () => {
  it('se lee por sus dos alias posibles', () => {
    expect(textoDe({ idCaptura: '9007199254740993' }, 'idCaptura', 'IdCaptura'))
      .toBe('9007199254740993');
    expect(textoDe({ IdCaptura: 5 }, 'idCaptura', 'IdCaptura')).toBe('5');
  });

  it('un backend anterior al Sprint 10 devuelve null, no un valor de reserva', () => {
    // Si aqui se inventara un id, los archivos adjuntos acabarian colgados de la
    // captura de OTRO asesor. Es preferible que queden invisibles para la cola.
    expect(textoDe({ success: true, message: 'ok' }, 'idCaptura', 'IdCaptura')).toBeNull();
  });

  it('conserva la precision de un BIGINT que excede el entero seguro', () => {
    // 9007199254740993 no es representable como number: Number(...) lo redondea a
    // ...992 SIN ERROR. Por eso viaja como string en todo el recorrido.
    const grande = '9007199254740993';
    expect(textoDe({ idCaptura: grande }, 'idCaptura')).toBe(grande);
    expect(String(Number(grande))).not.toBe(grande);
  });
});
