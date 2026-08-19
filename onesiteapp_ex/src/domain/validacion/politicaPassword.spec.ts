import { evaluarPolitica, LONGITUD_MINIMA, LONGITUD_MAXIMA } from './politicaPassword';

/**
 * La política es lo que separa una contraseña temporal de una definitiva segura. Si
 * una regla se relaja por accidente, el usuario podría "cambiar" a una clave débil y
 * la pantalla lo dejaría pasar. Estas pruebas fijan cada regla y sus límites.
 *
 * Convención de los casos: `ACTUAL` es la temporal contra la que se compara la nueva.
 */
const ACTUAL = 'Temporal1!';

describe('evaluarPolitica — caso válido', () => {
  it('marca esValida cuando se cumplen las siete reglas', () => {
    const r = evaluarPolitica(ACTUAL, 'Segura2026#', 'Segura2026#');
    expect(r.esValida).toBe(true);
  });
});

describe('evaluarPolitica — longitud (8 a 20 inclusive)', () => {
  it('rechaza 7 caracteres', () => {
    const val = 'Aa1#bc2'; // 7
    expect(val.length).toBe(LONGITUD_MINIMA - 1);
    expect(evaluarPolitica(ACTUAL, val, val).longitud).toBe(false);
  });

  it('acepta exactamente 8', () => {
    const val = 'Aa1#bcd2'; // 8
    expect(val.length).toBe(LONGITUD_MINIMA);
    expect(evaluarPolitica(ACTUAL, val, val).longitud).toBe(true);
  });

  it('acepta exactamente 20', () => {
    const val = 'Aa1#' + 'b'.repeat(16); // 20
    expect(val.length).toBe(LONGITUD_MAXIMA);
    expect(evaluarPolitica(ACTUAL, val, val).longitud).toBe(true);
  });

  it('rechaza 21 caracteres', () => {
    const val = 'Aa1#' + 'b'.repeat(17); // 21
    expect(val.length).toBe(LONGITUD_MAXIMA + 1);
    expect(evaluarPolitica(ACTUAL, val, val).longitud).toBe(false);
  });
});

describe('evaluarPolitica — clases de carácter', () => {
  it('detecta ausencia de mayúscula', () => {
    expect(evaluarPolitica(ACTUAL, 'segura2026#', 'segura2026#').mayuscula).toBe(false);
  });

  it('detecta ausencia de minúscula', () => {
    expect(evaluarPolitica(ACTUAL, 'SEGURA2026#', 'SEGURA2026#').minuscula).toBe(false);
  });

  it('detecta ausencia de número', () => {
    expect(evaluarPolitica(ACTUAL, 'SeguraClave#', 'SeguraClave#').numero).toBe(false);
  });

  it('detecta ausencia de carácter especial', () => {
    expect(evaluarPolitica(ACTUAL, 'Segura2026', 'Segura2026').especial).toBe(false);
  });

  it('acepta cada carácter especial permitido', () => {
    for (const c of '@#$%*!?&') {
      const val = `Segura2026${c}`;
      expect(evaluarPolitica(ACTUAL, val, val).especial).toBe(true);
    }
  });
});

describe('evaluarPolitica — reglas de negocio', () => {
  it('no coincide cuando la confirmación difiere', () => {
    const r = evaluarPolitica(ACTUAL, 'Segura2026#', 'Otra2026#');
    expect(r.coincideConfirmacion).toBe(false);
    expect(r.esValida).toBe(false);
  });

  it('no es distinta cuando la nueva es igual a la actual', () => {
    const r = evaluarPolitica('Segura2026#', 'Segura2026#', 'Segura2026#');
    expect(r.distintaDeActual).toBe(false);
    expect(r.esValida).toBe(false);
  });

  it('con los campos vacíos ninguna regla de comparación se marca en verde', () => {
    const r = evaluarPolitica('', '', '');
    expect(r.coincideConfirmacion).toBe(false);
    expect(r.distintaDeActual).toBe(false);
    expect(r.esValida).toBe(false);
  });
});
