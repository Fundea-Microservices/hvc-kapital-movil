import { evaluarVisibilidad, esVisible } from './visibilidad';
import { resolverIdDesdeToken, sanearTokenQEnJSON } from './tokens';
import { parseNumeroLocal } from './numeros';
import type { PreguntaEncuesta } from './tipos';

/** Constructor de preguntas para las pruebas: solo se especifica lo relevante. */
const pregunta = (parcial: Partial<PreguntaEncuesta> & { id: string }): PreguntaEncuesta => ({
  id_seccion: '1',
  id_matriz_padre: null,
  etiqueta: 'Pregunta',
  tipo_dato: 'TEXTO',
  opciones: null,
  origen_datos_tipo: null,
  origen_datos_cmd: null,
  es_obligatorio: 0,
  orden: 1,
  sintaxis_calculo: null,
  regla_visibilidad: null,
  regla_validacion: null,
  ...parcial,
});

describe('parseNumeroLocal', () => {
  it('interpreta la coma como decimal cuando va mas a la derecha', () => {
    expect(parseNumeroLocal('12,5')).toBe(12.5);
    expect(parseNumeroLocal('1.234,56')).toBe(1234.56);
  });

  it('interpreta el punto como decimal cuando va mas a la derecha', () => {
    expect(parseNumeroLocal('12.5')).toBe(12.5);
    expect(parseNumeroLocal('1,234.56')).toBe(1234.56);
  });

  it('descarta simbolos y espacios', () => {
    expect(parseNumeroLocal('Q 1,200.50')).toBe(1200.5);
  });

  it('devuelve NaN si no hay numero', () => {
    expect(Number.isNaN(parseNumeroLocal('abc'))).toBe(true);
    expect(Number.isNaN(parseNumeroLocal(''))).toBe(true);
  });
});

describe('resolverIdDesdeToken', () => {
  // Qn referencia el ID de la pregunta, no su orden. Asumir lo contrario rompio
  // todos los calculos y todas las reglas de visibilidad a la vez.
  const p31 = pregunta({ id: '31', orden: 5 });
  const p32 = pregunta({ id: '32', orden: 6 });
  const todas = [p31, p32];

  it('resuelve Qn contra el id de la pregunta', () => {
    expect(resolverIdDesdeToken('Q31', p32, todas)).toBe('31');
  });

  it('cae a orden solo si ningun id coincide, prefiriendo la misma seccion', () => {
    const otraSeccion = pregunta({ id: '90', orden: 7, id_seccion: '2' });
    const mismaSeccion = pregunta({ id: '91', orden: 7, id_seccion: '1' });
    expect(resolverIdDesdeToken('Q7', p31, [otraSeccion, mismaSeccion])).toBe('91');
  });

  it('devuelve la referencia tal cual si no es un token Qn', () => {
    expect(resolverIdDesdeToken('53', p31, todas)).toBe('53');
  });

  it('devuelve la referencia si el token no resuelve a nada', () => {
    expect(resolverIdDesdeToken('Q999', p31, todas)).toBe('Q999');
  });
});

describe('sanearTokenQEnJSON', () => {
  it('entrecomilla el token Qn sin comillas que emite el BackOffice', () => {
    // Sin esto, JSON.parse revienta y la regla entera se pierde.
    expect(JSON.parse(sanearTokenQEnJSON('{"dependeDeCatalogo":  Q10}'))).toEqual({ dependeDeCatalogo: 'Q10' });
    expect(JSON.parse(sanearTokenQEnJSON('{"dependeDeCatalogo": Q10}'))).toEqual({ dependeDeCatalogo: 'Q10' });
  });

  it('no altera un JSON que ya era valido', () => {
    expect(JSON.parse(sanearTokenQEnJSON('{"dependeDeCatalogo": 10}'))).toEqual({ dependeDeCatalogo: 10 });
    expect(JSON.parse(sanearTokenQEnJSON('{"dependeDeCatalogo": "Q10"}'))).toEqual({ dependeDeCatalogo: 'Q10' });
  });
});

describe('evaluarVisibilidad', () => {
  it('sin regla, la pregunta es visible', () => {
    expect(esVisible(pregunta({ id: '1' }), [], {})).toBe(true);
  });

  describe('cascada de catalogos', () => {
    const padre = pregunta({ id: '10', etiqueta: 'Departamento' });
    const hija = pregunta({ id: '11', etiqueta: 'Municipio', regla_visibilidad: '{"dependeDeCatalogo": Q10}' });

    it('oculta la hija mientras el padre no tenga respuesta', () => {
      expect(esVisible(hija, [padre, hija], {})).toBe(false);
      expect(esVisible(hija, [padre, hija], { '10': '   ' })).toBe(false);
    });

    it('muestra la hija en cuanto el padre responde', () => {
      expect(esVisible(hija, [padre, hija], { '10': 'CHIMALTENANGO' })).toBe(true);
    });
  });

  describe('igualdad simple', () => {
    const controlador = pregunta({ id: '53' });
    const dependiente = pregunta({ id: '55', regla_visibilidad: 'Q53=="SI"' });
    const todas = [controlador, dependiente];

    it('compara sin distinguir acentos ni mayusculas', () => {
      // El usuario puede haber elegido "Sí" y la regla decir "SI".
      ['SI', 'Sí', 'sí', 'si'].forEach(valor => {
        expect(esVisible(dependiente, todas, { '53': valor })).toBe(true);
      });
    });

    it('oculta cuando el valor no coincide', () => {
      expect(esVisible(dependiente, todas, { '53': 'NO' })).toBe(false);
    });

    it('admite el id crudo ademas del token Qn', () => {
      const conIdCrudo = pregunta({ id: '55', regla_visibilidad: '53=="SI"' });
      expect(esVisible(conIdCrudo, todas, { '53': 'SI' })).toBe(true);
    });

    it('acepta el formato JSON dependeDe/valorEsperado', () => {
      const conJson = pregunta({ id: '55', regla_visibilidad: '{"dependeDe": "53", "valorEsperado": "SI"}' });
      expect(esVisible(conJson, todas, { '53': 'SI' })).toBe(true);
      expect(esVisible(conJson, todas, { '53': 'NO' })).toBe(false);
    });
  });

  describe('dentro de una fila de matriz', () => {
    const controlador = pregunta({ id: '70', id_matriz_padre: '7' });
    const dependiente = pregunta({ id: '71', id_matriz_padre: '7', regla_visibilidad: 'Q70=="SI"' });
    const todas = [controlador, dependiente];

    it('cada fila se evalua con su propia respuesta', () => {
      const respuestas = { '70_filaA': 'SI', '70_filaB': 'NO' };
      expect(esVisible(dependiente, todas, respuestas, 'filaA')).toBe(true);
      expect(esVisible(dependiente, todas, respuestas, 'filaB')).toBe(false);
    });

    it('cae a la clave global si la fila no tiene valor propio', () => {
      // Permite que una regla dentro de la matriz referencie un campo de fuera.
      expect(esVisible(dependiente, todas, { '70': 'SI' }, 'filaA')).toBe(true);
    });
  });

  it('una regla malformada deja la pregunta VISIBLE y reporta el error', () => {
    // Ocultarla seria indistinguible de "sin regla" y el dato se perderia.
    const rota = pregunta({ id: '1', regla_visibilidad: '{esto no es json' });
    const resultado = evaluarVisibilidad(rota, [], {});
    expect(resultado.visible).toBe(true);
    expect(resultado.errorRegla).toBeDefined();
  });

  it('no reporta error cuando la regla es valida', () => {
    const ok = pregunta({ id: '1', regla_visibilidad: 'Q2=="SI"' });
    expect(evaluarVisibilidad(ok, [pregunta({ id: '2' }), ok], { '2': 'SI' }).errorRegla).toBeUndefined();
  });
});
