import {
  idPadreDeCascada,
  hijasDeCascada,
  descendientesDeCascada,
  limpiarDescendientesDeCascada,
} from './cascada';
import type { PreguntaEncuesta } from './tipos';

const pregunta = (parcial: Partial<PreguntaEncuesta> & { id: string }): PreguntaEncuesta => ({
  id_seccion: '1',
  id_matriz_padre: null,
  etiqueta: 'Pregunta',
  tipo_dato: 'SELECT',
  opciones: null,
  origen_datos_tipo: 'API',
  origen_datos_cmd: null,
  es_obligatorio: 0,
  orden: 1,
  sintaxis_calculo: null,
  regla_visibilidad: null,
  regla_validacion: null,
  ...parcial,
});

// Caso real: Departamento (10) -> Municipio (11) -> Aldea (12)
const departamento = pregunta({ id: '10', etiqueta: 'Departamento' });
const municipio = pregunta({ id: '11', etiqueta: 'Municipio', regla_visibilidad: '{"dependeDeCatalogo": Q10}' });
const aldea = pregunta({ id: '12', etiqueta: 'Aldea', regla_visibilidad: '{"dependeDeCatalogo": 11}' });
const suelta = pregunta({ id: '20', etiqueta: 'Otra cosa' });
const TODAS = [departamento, municipio, aldea, suelta];

describe('idPadreDeCascada', () => {
  it('lee el id del padre tanto con token Qn sin comillas como con id crudo', () => {
    expect(idPadreDeCascada(municipio, TODAS)).toBe('10');
    expect(idPadreDeCascada(aldea, TODAS)).toBe('11');
  });

  it('devuelve null si la pregunta no es hija de cascada', () => {
    expect(idPadreDeCascada(departamento, TODAS)).toBeNull();
    expect(idPadreDeCascada(suelta, TODAS)).toBeNull();
  });

  it('devuelve null ante una regla malformada, sin lanzar', () => {
    const rota = pregunta({ id: '9', regla_visibilidad: '{dependeDeCatalogo: roto' });
    expect(idPadreDeCascada(rota, TODAS)).toBeNull();
  });

  it('no confunde otras reglas de visibilidad con una cascada', () => {
    const condicional = pregunta({ id: '9', regla_visibilidad: '{"dependeDe": "5", "valorEsperado": "SI"}' });
    expect(idPadreDeCascada(condicional, TODAS)).toBeNull();
  });
});

describe('hijasDeCascada / descendientesDeCascada', () => {
  it('encuentra las hijas directas', () => {
    expect(hijasDeCascada('10', TODAS).map(p => p.id)).toEqual(['11']);
  });

  it('encuentra TODA la descendencia, no solo el primer nivel', () => {
    // Cambiar Departamento debe alcanzar tambien a Aldea, que cuelga de Municipio.
    expect(descendientesDeCascada('10', TODAS).map(p => p.id)).toEqual(['11', '12']);
  });

  it('una pregunta sin hijas devuelve lista vacia', () => {
    expect(descendientesDeCascada('20', TODAS)).toEqual([]);
  });

  it('no se cuelga ante una cascada circular mal configurada', () => {
    const a = pregunta({ id: 'A', regla_visibilidad: '{"dependeDeCatalogo": "B"}' });
    const b = pregunta({ id: 'B', regla_visibilidad: '{"dependeDeCatalogo": "A"}' });
    expect(descendientesDeCascada('A', [a, b]).map(p => p.id)).toEqual(['B']);
  });
});

describe('limpiarDescendientesDeCascada', () => {
  it('limpia el municipio al cambiar de departamento', () => {
    // El bug reportado: quedaba guardado un municipio del departamento anterior.
    const respuestas = { '10': 'CHIMALTENANGO', '11': 'PATZICIA' };
    const r = limpiarDescendientesDeCascada('10', 'CHIMALTENANGO', 'SOLOLA', respuestas, TODAS);
    expect(r.respuestas['11']).toBeUndefined();
    expect(r.clavesLimpiadas).toEqual(['11']);
  });

  it('limpia toda la cadena, no solo el hijo inmediato', () => {
    const respuestas = { '10': 'CHIMALTENANGO', '11': 'PATZICIA', '12': 'ALDEA X' };
    const r = limpiarDescendientesDeCascada('10', 'CHIMALTENANGO', 'SOLOLA', respuestas, TODAS);
    expect(r.respuestas['11']).toBeUndefined();
    expect(r.respuestas['12']).toBeUndefined();
    expect(r.clavesLimpiadas.sort()).toEqual(['11', '12']);
  });

  it('NO limpia si se vuelve a elegir el mismo valor', () => {
    // Volver a tocar el select y confirmar la misma opcion no debe borrar el trabajo.
    const respuestas = { '10': 'CHIMALTENANGO', '11': 'PATZICIA' };
    const r = limpiarDescendientesDeCascada('10', 'CHIMALTENANGO', 'CHIMALTENANGO', respuestas, TODAS);
    expect(r.respuestas['11']).toBe('PATZICIA');
    expect(r.clavesLimpiadas).toEqual([]);
  });

  it('limpia tambien al pasar de sin valor a con valor', () => {
    const respuestas = { '11': 'RESIDUO' };
    const r = limpiarDescendientesDeCascada('10', undefined, 'SOLOLA', respuestas, TODAS);
    expect(r.respuestas['11']).toBeUndefined();
  });

  it('no toca nada si la pregunta no tiene descendientes', () => {
    const respuestas = { '20': 'algo', '11': 'PATZICIA' };
    const r = limpiarDescendientesDeCascada('20', 'antes', 'despues', respuestas, TODAS);
    expect(r.respuestas).toEqual(respuestas);
    expect(r.clavesLimpiadas).toEqual([]);
  });

  it('dentro de una matriz solo limpia la fila afectada', () => {
    const enMatriz = [
      pregunta({ id: '30', id_matriz_padre: '3' }),
      pregunta({ id: '31', id_matriz_padre: '3', regla_visibilidad: '{"dependeDeCatalogo": "30"}' }),
    ];
    const respuestas = { '30_fA': 'A', '31_fA': 'hijoA', '30_fB': 'B', '31_fB': 'hijoB' };
    const r = limpiarDescendientesDeCascada('30', 'A', 'OTRO', respuestas, enMatriz, 'fA');
    expect(r.respuestas['31_fA']).toBeUndefined();
    expect(r.respuestas['31_fB']).toBe('hijoB'); // la otra fila queda intacta
  });

  it('no modifica el mapa recibido', () => {
    const respuestas = { '10': 'CHIMALTENANGO', '11': 'PATZICIA' };
    limpiarDescendientesDeCascada('10', 'CHIMALTENANGO', 'SOLOLA', respuestas, TODAS);
    expect(respuestas['11']).toBe('PATZICIA');
  });
});
