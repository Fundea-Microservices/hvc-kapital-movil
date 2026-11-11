import { filtrarClientes, contarPendientes, soloPendientes, GESTION, ClienteBuscable } from './busqueda';

const cliente = (parcial: Partial<ClienteBuscable> & { nombre: string }): ClienteBuscable => ({
  estado_gestion: GESTION.PENDIENTE,
  busqueda_normalizada: null,
  documento: null,
  cuenta: null,
  operacion: null,
  ...parcial,
});

const maria = cliente({
  nombre: 'María Elena Coc Xol',
  documento: '2588741250901',
  cuenta: '8842-01',
  operacion: '77120',
  busqueda_normalizada: '2588741250901 maria elena coc xol 8842-01 77120',
});

const ivan = cliente({
  nombre: 'Iván Esteban Pérez',
  estado_gestion: GESTION.COMPLETADO,
  documento: '1122334455667',
  busqueda_normalizada: '1122334455667 ivan esteban perez',
});

describe('filtrarClientes', () => {
  it('devuelve todo cuando la consulta está vacía', () => {
    expect(filtrarClientes([maria, ivan], '')).toHaveLength(2);
    expect(filtrarClientes([maria, ivan], '   ')).toHaveLength(2);
  });

  // El motivo de normalizar los DOS lados: el asesor teclea sin acentos.
  it('encuentra "María" escribiendo "maria" y al revés', () => {
    expect(filtrarClientes([maria, ivan], 'maria')).toEqual([maria]);
    expect(filtrarClientes([maria, ivan], 'MARÍA')).toEqual([maria]);
    expect(filtrarClientes([maria, ivan], 'ivan')).toEqual([ivan]);
    expect(filtrarClientes([maria, ivan], 'Iván')).toEqual([ivan]);
  });

  it('busca por documento, cuenta y operación', () => {
    expect(filtrarClientes([maria, ivan], '25887')).toEqual([maria]);
    expect(filtrarClientes([maria, ivan], '8842-01')).toEqual([maria]);
    expect(filtrarClientes([maria, ivan], '77120')).toEqual([maria]);
  });

  it('exige TODOS los términos y no depende de su orden', () => {
    expect(filtrarClientes([maria, ivan], 'coc maria')).toEqual([maria]);
    expect(filtrarClientes([maria, ivan], 'maria coc')).toEqual([maria]);
    expect(filtrarClientes([maria, ivan], 'maria perez')).toEqual([]);
  });

  it('colapsa espacios repetidos en la consulta', () => {
    expect(filtrarClientes([maria, ivan], '  maria    coc  ')).toEqual([maria]);
  });

  // Las filas AD-HOC y las migradas desde v9 no tienen el pajar calculado.
  it('busca igual una fila sin busqueda_normalizada', () => {
    const adHoc = cliente({ nombre: 'Pedro Ramírez' });
    expect(filtrarClientes([adHoc], 'ramirez')).toEqual([adHoc]);
    expect(filtrarClientes([adHoc], 'ramírez')).toEqual([adHoc]);
  });

  it('ordena pendientes antes que completados y luego por nombre', () => {
    const ana = cliente({ nombre: 'Ana Lopez' });
    const zoe = cliente({ nombre: 'Zoe Marroquin' });
    const ordenados = filtrarClientes([zoe, ivan, ana], '');
    expect(ordenados.map((c) => c.nombre)).toEqual([
      'Ana Lopez',
      'Zoe Marroquin',
      'Iván Esteban Pérez',
    ]);
  });

  // WatermelonDB reutiliza el array del observable: ordenarlo en sitio corrompería
  // la caché de la colección.
  it('no muta la lista recibida', () => {
    const entrada = [ivan, maria];
    const copia = [...entrada];
    filtrarClientes(entrada, '');
    expect(entrada).toEqual(copia);
  });

  it('devuelve lista vacía cuando nada casa', () => {
    expect(filtrarClientes([maria, ivan], 'zzzz')).toEqual([]);
  });
});

describe('contarPendientes', () => {
  it('cuenta solo el estado 0', () => {
    expect(contarPendientes([maria, ivan])).toBe(1);
    expect(contarPendientes([])).toBe(0);
    expect(contarPendientes([cliente({ nombre: 'X', estado_gestion: GESTION.CANCELADO })])).toBe(0);
  });
});

describe('soloPendientes', () => {
  const base = { busqueda_normalizada: '', nombre: 'x', documento: null, cuenta: null, operacion: null };
  it('oculta completadas y conserva el orden de las pendientes', () => {
    const lista = [
      { ...base, id: 'a', estado_gestion: 0 },
      { ...base, id: 'b', estado_gestion: 1 },
      { ...base, id: 'c', estado_gestion: 0 },
    ];
    expect(soloPendientes(lista).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('no muta el arreglo del observable', () => {
    const lista = [{ ...base, id: 'a', estado_gestion: 1 }];
    soloPendientes(lista);
    expect(lista).toHaveLength(1);
  });
});
