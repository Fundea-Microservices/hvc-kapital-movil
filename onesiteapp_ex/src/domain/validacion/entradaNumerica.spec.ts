import { esTipoNumerico, opcionesPorTipo, sanitizarEntradaNumerica } from './entradaNumerica';

describe('esTipoNumerico', () => {
  it('reconoce las variantes en ingles y en espanol que emite el BackOffice', () => {
    // NUMBER faltaba y por eso un campo numerico caia al input de texto libre.
    ['NUMBER', 'NUMERO', 'NUMERIC', 'DECIMAL', 'MONEDA', 'MONTO', 'FLOAT', 'ENTERO', 'INT', 'INTEGER']
      .forEach(t => expect(esTipoNumerico(t)).toBe(true));
  });

  it('normaliza mayusculas y espacios', () => {
    expect(esTipoNumerico(' numero ')).toBe(true);
    expect(esTipoNumerico('Decimal')).toBe(true);
  });

  it('no marca como numericos los tipos que comparten rama pero no lo son', () => {
    ['EMAIL', 'TELEFONO', 'TEXTO', 'SELECT', 'FECHA', '', null, undefined]
      .forEach(t => expect(esTipoNumerico(t)).toBe(false));
  });
});

describe('opcionesPorTipo', () => {
  it('los enteros no admiten separador decimal', () => {
    expect(opcionesPorTipo('ENTERO').permiteDecimales).toBe(false);
    expect(opcionesPorTipo('INT').permiteDecimales).toBe(false);
  });

  it('el resto de tipos numericos si', () => {
    expect(opcionesPorTipo('NUMBER').permiteDecimales).toBe(true);
    expect(opcionesPorTipo('MONEDA').permiteDecimales).toBe(true);
  });
});

describe('sanitizarEntradaNumerica', () => {
  const decimal = { permiteDecimales: true, permiteNegativos: true };
  const entero = { permiteDecimales: false, permiteNegativos: true };

  it('descarta letras intercaladas', () => {
    expect(sanitizarEntradaNumerica('12a3', decimal)).toBe('123');
    expect(sanitizarEntradaNumerica('abc', decimal)).toBe('');
  });

  it('conserva el separador tal como se teclea (el teclado en espanol da coma)', () => {
    // Normalizarlo al vuelo haria saltar el cursor mientras se escribe.
    expect(sanitizarEntradaNumerica('12,5', decimal)).toBe('12,5');
    expect(sanitizarEntradaNumerica('12.5', decimal)).toBe('12.5');
  });

  it('admite un unico separador decimal', () => {
    expect(sanitizarEntradaNumerica('1,2,3', decimal)).toBe('1,23');
    expect(sanitizarEntradaNumerica('1.2.3', decimal)).toBe('1.23');
  });

  it('los enteros descartan el separador', () => {
    expect(sanitizarEntradaNumerica('12,5', entero)).toBe('125');
  });

  it('respeta el signo negativo inicial y solo ese', () => {
    expect(sanitizarEntradaNumerica('-5', decimal)).toBe('-5');
    expect(sanitizarEntradaNumerica('5-3', decimal)).toBe('53');
    expect(sanitizarEntradaNumerica('-5', { ...decimal, permiteNegativos: false })).toBe('5');
  });

  it('limpia un monto pegado desde el portapapeles', () => {
    // Este es el caso que keyboardType NO cubre en Android.
    expect(sanitizarEntradaNumerica('Q 1,200.50', decimal)).toBe('1,20050');
  });

  it('tolera entrada vacia', () => {
    expect(sanitizarEntradaNumerica('', decimal)).toBe('');
  });
});
