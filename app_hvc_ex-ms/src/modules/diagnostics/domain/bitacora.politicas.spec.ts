import {
  MAX_ENTRADAS_POR_LOTE,
  MAX_MENSAJE,
  normalizarEntrada,
  normalizarFecha,
  normalizarLote,
  normalizarNivel,
} from './bitacora.politicas';

describe('normalizarNivel', () => {
  it('reconoce WARN sin importar el formato', () => {
    ['WARN', 'warn', ' Warn '].forEach((v) =>
      expect(normalizarNivel(v)).toBe('WARN'),
    );
  });

  it('cualquier otro valor cae a ERROR, no se descarta', () => {
    // Una entrada con el nivel mal escrito sigue siendo informacion de un fallo real.
    ['ERROR', 'critico', '', null, undefined, 42].forEach((v) =>
      expect(normalizarNivel(v)).toBe('ERROR'),
    );
  });
});

describe('normalizarFecha — el reloj del dispositivo no es de fiar', () => {
  const ahora = new Date('2026-08-10T12:00:00.000Z').getTime();

  it('acepta una fecha reciente', () => {
    const fecha = new Date(ahora - 60 * 60 * 1000).toISOString();
    expect(normalizarFecha(fecha, ahora)).toBe(fecha);
  });

  it('rechaza una fecha de hace mas de un anio', () => {
    // Un movil con el reloj en 1970 desordenaria la bitacora entera.
    expect(normalizarFecha('1970-01-01T00:00:00.000Z', ahora)).toBeNull();
  });

  it('rechaza una fecha en el futuro', () => {
    expect(normalizarFecha('2090-01-01T00:00:00.000Z', ahora)).toBeNull();
  });

  it('rechaza texto que no es una fecha', () => {
    ['', 'ayer', null, undefined, '2026-13-45'].forEach((v) =>
      expect(normalizarFecha(v, ahora)).toBeNull(),
    );
  });
});

describe('normalizarEntrada', () => {
  const base = {
    nivel: 'ERROR',
    origen: 'syncManager.FASE1',
    mensaje: 'Fallo la subida',
    detalle: 'Error: x\n  at y',
    contexto: '{"idEncuesta":3}',
    versionApp: '1.4.5',
    plataforma: 'android',
    fechaError: new Date().toISOString(),
  };

  it('normaliza una entrada completa', () => {
    const e = normalizarEntrada(base);
    expect(e?.nivel).toBe('ERROR');
    expect(e?.origen).toBe('syncManager.FASE1');
    expect(e?.mensaje).toBe('Fallo la subida');
    expect(e?.versionApp).toBe('1.4.5');
  });

  it('DESCARTA una entrada sin mensaje', () => {
    // Sin mensaje no hay nada que diagnosticar: seria ruido en la tabla.
    expect(normalizarEntrada({ ...base, mensaje: '' })).toBeNull();
    expect(normalizarEntrada({ ...base, mensaje: '   ' })).toBeNull();
  });

  it('recorta los campos al ancho de las columnas', () => {
    // Una app manipulada o una version antigua puede mandar campos larguisimos; sin
    // el recorte, el INSERT falla por truncamiento y se pierde el lote completo.
    const e = normalizarEntrada({ ...base, mensaje: 'm'.repeat(5000) });
    expect(e?.mensaje.length).toBe(MAX_MENSAJE);
  });

  it('colapsa los saltos de linea del stack', () => {
    expect(normalizarEntrada(base)?.detalle).toBe('Error: x at y');
  });

  it('rellena los opcionales ausentes con valores seguros', () => {
    const e = normalizarEntrada({ nivel: '', origen: '', mensaje: 'algo' });
    expect(e?.origen).toBe('desconocido');
    expect(e?.versionApp).toBe('0.0.0');
    expect(e?.detalle).toBeNull();
    expect(e?.plataforma).toBeNull();
  });
});

describe('normalizarLote', () => {
  const entrada = (n: number) => ({
    nivel: 'ERROR',
    origen: 'o',
    mensaje: `msg ${n}`,
  });

  it('TRUNCA en lugar de rechazar el lote entero', () => {
    // Si se devolviera un error, el dispositivo reintentaria el mismo lote gigante
    // indefinidamente. Quedarse con las primeras conserva informacion util.
    const lote = Array.from({ length: 500 }, (_, i) => entrada(i));
    expect(normalizarLote(lote)).toHaveLength(MAX_ENTRADAS_POR_LOTE);
  });

  it('descarta las entradas invalidas sin perder las buenas', () => {
    const lote = [entrada(1), { mensaje: '' }, null, entrada(2)];
    expect(normalizarLote(lote)).toHaveLength(2);
  });

  it('un cuerpo que no es arreglo devuelve lista vacia', () => {
    [null, undefined, {}, 'texto', 42].forEach((v) =>
      expect(normalizarLote(v)).toEqual([]),
    );
  });
});
