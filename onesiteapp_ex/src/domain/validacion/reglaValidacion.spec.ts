import { parsearReglaValidacion, validarValor } from './reglaValidacion';

/**
 * `validarValor` es el corazón de la validación institucional. Aquí se cubre en
 * particular la parametrización del mensaje (`MensajeError` del BackOffice): cuando
 * llega, sustituye el texto por defecto; cuando no, se conserva el de siempre, de
 * modo que una regla sin mensaje custom se comporta exactamente como antes.
 */

describe('validarValor — mensaje de error parametrizable', () => {
  it('usa el mensaje custom cuando falla un patrón', () => {
    const regla = parsearReglaValidacion('DIGITS(13)');
    const r = validarValor('123', regla, 'El DPI debe tener 13 dígitos.');
    expect(r.valido).toBe(false);
    expect(r.mensaje).toBe('El DPI debe tener 13 dígitos.');
  });

  it('usa el mensaje custom cuando falla un rango', () => {
    const regla = parsearReglaValidacion('RANGE(18,65)');
    const r = validarValor('90', regla, 'La edad debe estar entre 18 y 65.');
    expect(r.valido).toBe(false);
    expect(r.mensaje).toBe('La edad debe estar entre 18 y 65.');
  });

  it('cae al texto por defecto cuando no se pasa mensaje (patrón)', () => {
    const regla = parsearReglaValidacion('DIGITS(13)');
    const r = validarValor('123', regla);
    expect(r.valido).toBe(false);
    expect(r.mensaje).toBe('Formato incorrecto según regla institucional.');
  });

  it('cae al texto por defecto cuando el mensaje es null (rango)', () => {
    const regla = parsearReglaValidacion('RANGE(1,10)');
    const r = validarValor('20', regla, null);
    expect(r.valido).toBe(false);
    expect(r.mensaje).toBe('El valor debe estar entre 1 y 10.');
  });

  it('un valor válido no arrastra ningún mensaje aunque se pase uno', () => {
    const regla = parsearReglaValidacion('DIGITS(3)');
    const r = validarValor('123', regla, 'No debería aparecer.');
    expect(r.valido).toBe(true);
    expect(r.mensaje).toBeNull();
  });

  it('un valor vacío se considera válido (la obligatoriedad se valida aparte)', () => {
    const regla = parsearReglaValidacion('DIGITS(13)');
    const r = validarValor('', regla, 'El DPI debe tener 13 dígitos.');
    expect(r.valido).toBe(true);
    expect(r.mensaje).toBeNull();
  });
});
