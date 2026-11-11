import { aplicarCalculos } from './calculo';
import type { PreguntaEncuesta } from './tipos';

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
  mensaje_error: null,
  mensaje_notificacion: null,
  ...parcial,
});

const calculo = (id: string, formula: string, extra: Partial<PreguntaEncuesta> = {}) =>
  pregunta({ id, tipo_dato: 'CALCULO', sintaxis_calculo: formula, etiqueta: `Calculo ${id}`, ...extra });

describe('aplicarCalculos', () => {
  it('resuelve una resta simple con tokens Qn', () => {
    // Caso real del BackOffice: Q31-Q30 sobre la pregunta 32.
    const preguntas = [pregunta({ id: '30' }), pregunta({ id: '31' }), calculo('32', 'Q31-Q30')];
    const { respuestas } = aplicarCalculos({ '30': '100', '31': '250' }, preguntas);
    expect(respuestas['32']).toBe('150');
  });

  it('normaliza los placeholders con corchetes documentados', () => {
    // Sin normalizar, mathjs lee [..] como literal de matriz y devuelve NaN.
    const preguntas = [pregunta({ id: '91' }), pregunta({ id: '92' }), calculo('93', '[Q92]-[Q91]')];
    expect(aplicarCalculos({ '91': '10', '92': '35' }, preguntas).respuestas['93']).toBe('25');

    const conNumeros = [pregunta({ id: '91' }), pregunta({ id: '92' }), calculo('94', '[92]-[91]')];
    expect(aplicarCalculos({ '91': '10', '92': '35' }, conNumeros).respuestas['94']).toBe('25');
  });

  it('el destino es la pregunta que lleva la formula, sin importar el lado del =', () => {
    const preguntas = [pregunta({ id: '1' }), pregunta({ id: '2' }), calculo('3', 'Q3 = Q2 - Q1')];
    expect(aplicarCalculos({ '1': '5', '2': '12' }, preguntas).respuestas['3']).toBe('7');

    const alReves = [pregunta({ id: '1' }), pregunta({ id: '2' }), calculo('4', 'Q2 - Q1 = Q4')];
    expect(aplicarCalculos({ '1': '5', '2': '12' }, alReves).respuestas['4']).toBe('7');
  });

  it('respeta las funciones de mathjs (que son sensibles a mayusculas)', () => {
    // Pasar la formula entera a mayusculas romperia round().
    const preguntas = [pregunta({ id: '1' }), calculo('2', 'round(Q1)')];
    expect(aplicarCalculos({ '1': '7.6' }, preguntas).respuestas['2']).toBe('8');
  });

  it('no confunde Q1 con Q12 al sustituir', () => {
    const preguntas = [pregunta({ id: '1' }), pregunta({ id: '12' }), calculo('13', 'Q12-Q1')];
    expect(aplicarCalculos({ '1': '2', '12': '30' }, preguntas).respuestas['13']).toBe('28');
  });

  it('acepta coma decimal del teclado en espanol', () => {
    const preguntas = [pregunta({ id: '1' }), pregunta({ id: '2' }), calculo('3', 'Q1+Q2')];
    expect(aplicarCalculos({ '1': '10,5', '2': '4,5' }, preguntas).respuestas['3']).toBe('15');
  });

  it('encadena calculos que dependen de otros calculos', () => {
    const preguntas = [
      pregunta({ id: '1' }),
      pregunta({ id: '2' }),
      calculo('3', 'Q1+Q2'),
      calculo('4', 'Q3*2'),
    ];
    const { respuestas } = aplicarCalculos({ '1': '10', '2': '5' }, preguntas);
    expect(respuestas['3']).toBe('15');
    expect(respuestas['4']).toBe('30');
  });

  it('vacia el destino si algun operando deja de ser numerico', () => {
    // No debe quedarse con un resultado obsoleto que ya no corresponde.
    const preguntas = [pregunta({ id: '1' }), pregunta({ id: '2' }), calculo('3', 'Q1+Q2')];
    const { respuestas } = aplicarCalculos({ '1': '10', '2': '', '3': '999' }, preguntas);
    expect(respuestas['3']).toBe('');
  });

  it('redondea a dos decimales', () => {
    const preguntas = [pregunta({ id: '1' }), pregunta({ id: '2' }), calculo('3', 'Q1/Q2')];
    expect(aplicarCalculos({ '1': '10', '2': '3' }, preguntas).respuestas['3']).toBe('3.33');
  });

  describe('dentro de matrices', () => {
    const preguntas = [
      pregunta({ id: '20', id_matriz_padre: '2' }),
      pregunta({ id: '21', id_matriz_padre: '2' }),
      calculo('22', 'Q21-Q20', { id_matriz_padre: '2' }),
    ];

    it('se evalua una vez por fila, con el valor de esa fila', () => {
      const { respuestas } = aplicarCalculos(
        { '20_fA': '10', '21_fA': '30', '20_fB': '5', '21_fB': '9' },
        preguntas,
        { '2': ['fA', 'fB'] },
      );
      expect(respuestas['22_fA']).toBe('20');
      expect(respuestas['22_fB']).toBe('4');
      // No debe escribir en la clave global.
      expect(respuestas['22']).toBeUndefined();
    });

    it('un token puede referenciar un campo de FUERA de la matriz', () => {
      const conExterno = [
        pregunta({ id: '9' }),
        pregunta({ id: '20', id_matriz_padre: '2' }),
        calculo('22', 'Q20*Q9', { id_matriz_padre: '2' }),
      ];
      const { respuestas } = aplicarCalculos(
        { '9': '3', '20_fA': '10' },
        conExterno,
        { '2': ['fA'] },
      );
      expect(respuestas['22_fA']).toBe('30');
    });

    it('sin filas activas no calcula nada', () => {
      const { respuestas } = aplicarCalculos({ '20_fA': '10' }, preguntas, { '2': [] });
      expect(respuestas['22_fA']).toBeUndefined();
    });
  });

  it('reporta un aviso cuando un token no resuelve, sin lanzar', () => {
    const preguntas = [calculo('3', 'Q999+1')];
    const { avisos, respuestas } = aplicarCalculos({}, preguntas);
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos[0].etiqueta).toBe('Calculo 3');
    expect(respuestas['3']).toBeUndefined();
  });

  it('no modifica el mapa recibido', () => {
    const base = { '1': '10', '2': '5' };
    const preguntas = [pregunta({ id: '1' }), pregunta({ id: '2' }), calculo('3', 'Q1+Q2')];
    aplicarCalculos(base, preguntas);
    expect(base).toEqual({ '1': '10', '2': '5' });
  });
});
