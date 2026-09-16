import { aClienteAsignado, ETIQUETAS_POR_DEFECTO } from './precargaAdapter';

describe('respaldo en valores cuando la columna plana llega nula', () => {
  // Ambos payloads son copias literales de GET /api/onesiteex/precarga (2026-09-08).
  const catalogo = new Map([
    ['287', 'DPI'],
    ['288', 'Nombre Completo'],
    ['289', 'Código cliente'],
  ]);

  const fila = (extra: Record<string, unknown>) => ({
    id: 'ID-1',
    idEncuesta: 5,
    estado: 'CARGADO',
    ...extra,
  });

  it('carga con Nombre en valores: la tarjeta NO queda como "CLIENTE SIN NOMBRE"', () => {
    const cliente = aClienteAsignado(
      fila({
        cuenta: 'CARGA004',
        documento: null,
        nombres: null,
        valores: [
          { id_pregunta: '288', valor: 'ZOILA TEC' },
          { id_pregunta: '289', valor: 'COD07' },
        ],
      }),
      ETIQUETAS_POR_DEFECTO,
      catalogo,
    );
    expect(cliente?.nombre).toBe('ZOILA TEC');
    expect(cliente?.expediente).toBe('COD07');
    // El nombre recuperado debe alimentar también la búsqueda.
    expect(cliente?.busqueda_normalizada).toContain('zoila tec');
  });

  it('carga con DPI en valores y sin columna documento: lo recupera igual', () => {
    const cliente = aClienteAsignado(
      fila({
        cuenta: 'GT001',
        documento: null,
        nombres: null,
        valores: [
          { id_pregunta: '287', valor: '1111111110401' },
          { id_pregunta: '289', valor: 'TEST-001' },
        ],
      }),
      ETIQUETAS_POR_DEFECTO,
      catalogo,
    );
    expect(cliente?.documento).toBe('1111111110401');
    expect(cliente?.busqueda_normalizada).toContain('1111111110401');
  });

  it('la columna plana tiene prioridad sobre el valor de la pregunta', () => {
    const cliente = aClienteAsignado(
      fila({
        documento: 'DE-LA-COLUMNA',
        nombres: null,
        valores: [{ id_pregunta: '287', valor: 'DE-VALORES' }],
      }),
      ETIQUETAS_POR_DEFECTO,
      catalogo,
    );
    expect(cliente?.documento).toBe('DE-LA-COLUMNA');
  });

  it('sin nombre por ningún lado cae al documento, no a un texto genérico', () => {
    const cliente = aClienteAsignado(
      fila({ documento: '999', nombres: null, valores: [] }),
      ETIQUETAS_POR_DEFECTO,
      catalogo,
    );
    expect(cliente?.nombre).toBe('999');
  });
});
