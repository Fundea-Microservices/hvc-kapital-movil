import {
  MAPEO_POR_DEFECTO,
  mapeoDesdeEntorno,
  extraerFilas,
  normalizarFilaExterna,
  ordenarOpciones,
  normalizarRespuesta,
  MapeoRespuestaExterna,
} from './catalogos-externos.mapeo';

/** Recorte fiel del payload real de la API (grupo=pais, valorCore=320) — 3 departamentos desordenados. */
const RESPUESTA_DEPARTAMENTOS_REAL = {
  success: true,
  statusCode: '200',
  data: {
    catalogos: [
      {
        catalogoId: '57D92E70-87AE-456A-BA65-AE086286D500',
        grupo: 'pais',
        nombre: 'GUATEMALA',
        valorCore: '320',
        padreId: null,
        padre: null,
        hijos: [
          {
            catalogoId: 'F610B374-72D4-450F-BF90-0339AC1B6D4D',
            grupo: 'departamento',
            nombre: 'RETALHULEU',
            valorCore: '15',
            padreId: '57D92E70-87AE-456A-BA65-AE086286D500',
            padreValorCore: '320',
            activo: true,
            orden: 0,
          },
          {
            catalogoId: 'F8BCCF6C-638D-4EE9-8659-24E8CB4031A2',
            grupo: 'departamento',
            nombre: 'ALTA VERAPAZ',
            valorCore: '2',
            padreId: '57D92E70-87AE-456A-BA65-AE086286D500',
            padreValorCore: '320',
            activo: true,
            orden: 0,
          },
          {
            catalogoId: 'F8EBF545-BBC7-49E6-B6DE-309B35F64515',
            grupo: 'departamento',
            nombre: 'QUETZALTENANGO',
            valorCore: '14',
            padreId: '57D92E70-87AE-456A-BA65-AE086286D500',
            padreValorCore: '320',
            activo: true,
            orden: 0,
          },
        ],
        padreValorCore: null,
        activo: true,
        orden: 0,
      },
    ],
  },
  metadata: { total: 1 },
};

/** Recorte fiel del payload real (grupo=departamento, valorCore=11) — municipios de Chimaltenango. */
const RESPUESTA_MUNICIPIOS_REAL = {
  success: true,
  data: {
    catalogos: [
      {
        catalogoId: '9EA2C5C7-624A-4CC3-95B8-3FA127AD1183',
        grupo: 'departamento',
        nombre: 'CHIMALTENANGO',
        valorCore: '11',
        padreId: '57D92E70-87AE-456A-BA65-AE086286D500',
        padre: { grupo: 'pais', nombre: 'GUATEMALA', valorCore: '320' },
        hijos: [
          { grupo: 'municipio', nombre: 'PATZICÍA', valorCore: '126', padreValorCore: '11', activo: true, orden: 0 },
          { grupo: 'municipio', nombre: 'ZARAGOZA', valorCore: '132', padreValorCore: '11', activo: true, orden: 0 },
        ],
      },
    ],
  },
};

describe('extraerFilas', () => {
  it('desenvuelve data.catalogos[0].hijos del payload real de departamentos', () => {
    const filas = extraerFilas(RESPUESTA_DEPARTAMENTOS_REAL, MAPEO_POR_DEFECTO);
    expect(filas).toHaveLength(3);
    expect((filas[0] as { nombre: string }).nombre).toBe('RETALHULEU');
  });

  it('desenvuelve data.catalogos[0].hijos del payload real de municipios', () => {
    const filas = extraerFilas(RESPUESTA_MUNICIPIOS_REAL, MAPEO_POR_DEFECTO);
    expect(filas).toHaveLength(2);
  });

  it('acepta un arreglo plano en la raíz', () => {
    const filas = extraerFilas([{ valorCore: '1', nombre: 'A' }], MAPEO_POR_DEFECTO);
    expect(filas).toHaveLength(1);
  });

  it('acepta envoltura {data: [...]} sin nodo raíz', () => {
    const filas = extraerFilas({ data: [{ valorCore: '1', nombre: 'A' }] }, MAPEO_POR_DEFECTO);
    expect(filas).toHaveLength(1);
  });

  it('envoltura desconocida -> [] sin lanzar', () => {
    expect(extraerFilas({ algo: 'inesperado' }, MAPEO_POR_DEFECTO)).toEqual([]);
    expect(extraerFilas(null, MAPEO_POR_DEFECTO)).toEqual([]);
    expect(extraerFilas(undefined, MAPEO_POR_DEFECTO)).toEqual([]);
    expect(extraerFilas('texto', MAPEO_POR_DEFECTO)).toEqual([]);
  });
});

describe('normalizarFilaExterna', () => {
  it('usa valorCore como código, no catalogoId', () => {
    const fila = {
      catalogoId: 'F610B374-72D4-450F-BF90-0339AC1B6D4D',
      nombre: 'RETALHULEU',
      valorCore: '15',
      activo: true,
    };
    expect(normalizarFilaExterna(fila, MAPEO_POR_DEFECTO)).toEqual({
      codigo: '15',
      etiqueta: 'RETALHULEU',
      orden: 0,
    });
  });

  it('descarta una fila con activo: false', () => {
    const fila = { valorCore: '1', nombre: 'X', activo: false };
    expect(normalizarFilaExterna(fila, MAPEO_POR_DEFECTO)).toBeNull();
  });

  it.each(['0', 0, 'no'] as const)('descarta activo=%p', (valorInactivo) => {
    const fila = { valorCore: '1', nombre: 'X', activo: valorInactivo };
    expect(normalizarFilaExterna(fila, MAPEO_POR_DEFECTO)).toBeNull();
  });

  it('conserva una fila SIN el campo activo (se asume activa)', () => {
    const fila = { valorCore: '1', nombre: 'X' };
    expect(normalizarFilaExterna(fila, MAPEO_POR_DEFECTO)).toEqual({ codigo: '1', etiqueta: 'X', orden: 0 });
  });

  it('null si falta código o etiqueta', () => {
    expect(normalizarFilaExterna({ nombre: 'X' }, MAPEO_POR_DEFECTO)).toBeNull();
    expect(normalizarFilaExterna({ valorCore: '1' }, MAPEO_POR_DEFECTO)).toBeNull();
    expect(normalizarFilaExterna('no-es-objeto', MAPEO_POR_DEFECTO)).toBeNull();
  });

  it('respeta el orden explícito de la API cuando es un número', () => {
    const fila = { valorCore: '1', nombre: 'X', orden: 5 };
    expect(normalizarFilaExterna(fila, MAPEO_POR_DEFECTO)?.orden).toBe(5);
  });
});

describe('ordenarOpciones', () => {
  const opciones = [
    { codigo: '15', etiqueta: 'RETALHULEU', orden: 0 },
    { codigo: '2', etiqueta: 'ALTA VERAPAZ', orden: 0 },
    { codigo: '14', etiqueta: 'QUETZALTENANGO', orden: 0 },
  ];

  it('con todos en orden=0, desempata alfabéticamente (es-ES, sin distinguir mayúsculas)', () => {
    const resultado = ordenarOpciones(opciones, MAPEO_POR_DEFECTO);
    expect(resultado.map((o) => o.etiqueta)).toEqual(['ALTA VERAPAZ', 'QUETZALTENANGO', 'RETALHULEU']);
  });

  it('el orden numérico significativo manda sobre el alfabético', () => {
    const conOrden = [
      { codigo: '1', etiqueta: 'ZETA', orden: 1 },
      { codigo: '2', etiqueta: 'ALFA', orden: 0 },
    ];
    expect(ordenarOpciones(conOrden, MAPEO_POR_DEFECTO).map((o) => o.etiqueta)).toEqual(['ALFA', 'ZETA']);
  });

  it('ordenarAlfabetico: false conserva el orden de llegada en el desempate', () => {
    const mapeo: MapeoRespuestaExterna = { ...MAPEO_POR_DEFECTO, ordenarAlfabetico: false };
    const resultado = ordenarOpciones(opciones, mapeo);
    expect(resultado.map((o) => o.etiqueta)).toEqual(['RETALHULEU', 'ALTA VERAPAZ', 'QUETZALTENANGO']);
  });
});

describe('normalizarRespuesta (extraer -> normalizar -> ordenar, punta a punta)', () => {
  it('con el payload real de departamentos, produce 3 opciones ordenadas alfabéticamente', () => {
    const resultado = normalizarRespuesta(RESPUESTA_DEPARTAMENTOS_REAL, MAPEO_POR_DEFECTO);
    expect(resultado).toEqual([
      { codigo: '2', etiqueta: 'ALTA VERAPAZ', orden: 0 },
      { codigo: '14', etiqueta: 'QUETZALTENANGO', orden: 0 },
      { codigo: '15', etiqueta: 'RETALHULEU', orden: 0 },
    ]);
  });

  it('con el payload real de municipios, produce las 2 opciones esperadas', () => {
    const resultado = normalizarRespuesta(RESPUESTA_MUNICIPIOS_REAL, MAPEO_POR_DEFECTO);
    expect(resultado.map((o) => o.etiqueta)).toEqual(['PATZICÍA', 'ZARAGOZA']);
    expect(resultado.map((o) => o.codigo)).toEqual(['126', '132']);
  });

  it('una fila inactiva mezclada con activas se descarta y no rompe el orden', () => {
    const cuerpo = {
      data: {
        catalogos: [
          {
            hijos: [
              { valorCore: '3', nombre: 'C', activo: true },
              { valorCore: '1', nombre: 'A', activo: false },
              { valorCore: '2', nombre: 'B', activo: true },
            ],
          },
        ],
      },
    };
    expect(normalizarRespuesta(cuerpo, MAPEO_POR_DEFECTO).map((o) => o.etiqueta)).toEqual(['B', 'C']);
  });
});

describe('mapeoDesdeEntorno', () => {
  const leerVacio = () => undefined;

  it('sin ninguna variable definida, produce exactamente MAPEO_POR_DEFECTO', () => {
    expect(mapeoDesdeEntorno(leerVacio)).toEqual(MAPEO_POR_DEFECTO);
  });

  it('parsea listas separadas por coma para camposCodigo/camposEtiqueta/clavesHijos', () => {
    const entorno: Record<string, string> = {
      API_CATALOGOS_EXT_CAMPOS_CODIGO: 'codigoExterno, otraClave',
      API_CATALOGOS_EXT_CLAVES_HIJOS: 'nodos',
    };
    const mapeo = mapeoDesdeEntorno((clave) => entorno[clave]);
    expect(mapeo.camposCodigo).toEqual(['codigoExterno', 'otraClave']);
    expect(mapeo.clavesHijos).toEqual(['nodos']);
    // Lo no configurado sigue cayendo al default.
    expect(mapeo.camposEtiqueta).toEqual(MAPEO_POR_DEFECTO.camposEtiqueta);
  });

  it('ORDENAR_ALFABETICO=false desactiva el desempate alfabético', () => {
    const mapeo = mapeoDesdeEntorno((clave) =>
      clave === 'API_CATALOGOS_EXT_ORDENAR_ALFABETICO' ? 'false' : undefined,
    );
    expect(mapeo.ordenarAlfabetico).toBe(false);
  });

  it('CAMPO_ACTIVO vacío desactiva el filtro de actividad (campoActivo: null)', () => {
    const mapeo = mapeoDesdeEntorno((clave) => (clave === 'API_CATALOGOS_EXT_CAMPO_ACTIVO' ? '' : undefined));
    expect(mapeo.campoActivo).toBeNull();
  });
});
