import { aPreguntaEncuesta, aOpcionCatalogo } from './preguntaAdapter';

/**
 * El adaptador es la pieza que hace posible que el dominio sea puro: aplana los
 * modelos de WatermelonDB al contrato del motor. Su valor está en la doble lectura
 * `propiedad del modelo ?? _raw`, necesaria porque el decorador devuelve `undefined`
 * para columnas añadidas por migración en registros antiguos — un dispositivo que
 * actualizó la app arrastra filas escritas con el esquema anterior.
 *
 * Se construyen dobles con la forma que expone WatermelonDB (`_raw` más las
 * propiedades del decorador) en vez de instanciar modelos reales: crear un modelo
 * exige una base abierta, y aquí lo que importa es exactamente esa doble lectura.
 */

type Doble = { _raw: Record<string, unknown> } & Record<string, unknown>;

const modelo = (propiedades: Record<string, unknown>, raw: Record<string, unknown>): Doble =>
  ({ ...propiedades, _raw: raw }) as Doble;

describe('aPreguntaEncuesta', () => {
  it('prefiere la propiedad del modelo cuando existe', () => {
    const p = modelo({ id: '1', etiqueta: 'Del modelo' }, { etiqueta: 'Del raw' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(aPreguntaEncuesta(p as any).etiqueta).toBe('Del modelo');
  });

  it('CAE AL _raw cuando el decorador devuelve undefined', () => {
    // Es el caso de una columna añadida por migración leída en un registro antiguo.
    // Sin este respaldo, el campo llega vacío con la base perfectamente sana.
    const p = modelo({ id: '1' }, { etiqueta: 'Solo en raw', tipo_dato: 'SELECT' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plana = aPreguntaEncuesta(p as any);
    expect(plana.etiqueta).toBe('Solo en raw');
    expect(plana.tipo_dato).toBe('SELECT');
  });

  it('usa valores por defecto seguros en vez de undefined', () => {
    // El motor compara tipos con `.trim().toUpperCase()`: un undefined aquí lanzaría.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plana = aPreguntaEncuesta(modelo({ id: '9' }, {}) as any);
    expect(plana.etiqueta).toBe('Sin etiqueta');
    expect(plana.tipo_dato).toBe('TEXTO');
    expect(plana.es_obligatorio).toBe(0);
    expect(plana.orden).toBe(0);
  });

  it('normaliza la ausencia a null, nunca a la cadena vacia', () => {
    // El contrato del dominio declara `string | null` a propósito: declarar estos
    // campos como opcionales fue la causa de un bug real en el pasado.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plana = aPreguntaEncuesta(modelo({ id: '1', opciones: '' }, {}) as any);
    expect(plana.opciones).toBeNull();
    expect(plana.regla_visibilidad).toBeNull();
    expect(plana.sintaxis_calculo).toBeNull();
  });

  it('los identificadores siempre salen como texto', () => {
    // SQLite devuelve enteros y el motor compara con `===` contra strings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plana = aPreguntaEncuesta(modelo({ id: 7, id_seccion: 3 }, {}) as any);
    expect(plana.id).toBe('7');
    expect(plana.id_seccion).toBe('3');
  });

  it('es_obligatorio y orden toleran texto numerico', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plana = aPreguntaEncuesta(modelo({ id: '1' }, { es_obligatorio: '1', orden: '5' }) as any);
    expect(plana.es_obligatorio).toBe(1);
    expect(plana.orden).toBe(5);
  });

  it('mapea mensaje_error y mensaje_notificacion desde el modelo y el _raw', () => {
    // Columnas de la migración v11: como el resto, se leen del modelo y del _raw.
    const p = modelo(
      { id: '1', mensaje_error: 'Error del modelo' },
      { mensaje_notificacion: 'Recordatorio del raw' },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plana = aPreguntaEncuesta(p as any);
    expect(plana.mensaje_error).toBe('Error del modelo');
    expect(plana.mensaje_notificacion).toBe('Recordatorio del raw');
  });

  it('mensaje_error y mensaje_notificacion ausentes quedan en null', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plana = aPreguntaEncuesta(modelo({ id: '1' }, {}) as any);
    expect(plana.mensaje_error).toBeNull();
    expect(plana.mensaje_notificacion).toBeNull();
  });
});

describe('aOpcionCatalogo', () => {
  it('lee todo desde _raw', () => {
    const c = modelo({}, {
      id_remoto: 42,
      nombre_catalogo: 'CAT_Departamentos',
      codigo_catalogo: 'DEP',
      codigo_opcion: 'GT',
      valor_opcion: 'Guatemala',
      id_padre_opcion: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(aOpcionCatalogo(c as any)).toEqual({
      id_remoto: '42',
      nombre_catalogo: 'CAT_Departamentos',
      codigo_catalogo: 'DEP',
      codigo_opcion: 'GT',
      valor_opcion: 'Guatemala',
      id_padre_opcion: null,
    });
  });

  it('una opcion sin padre queda en null, no en "null"', () => {
    // La cascada compara `String(id_padre_opcion) === idPadre`. Un literal "null"
    // convertiría a huérfanas todas las opciones raíz.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(aOpcionCatalogo(modelo({}, { id_padre_opcion: null }) as any).id_padre_opcion).toBeNull();
  });
});
