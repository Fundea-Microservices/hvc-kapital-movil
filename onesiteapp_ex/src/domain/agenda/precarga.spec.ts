import {
  parsearValoresPrecarga,
  resolverEtiqueta,
  enriquecerConEtiquetas,
  esNombreMarcador,
  construirTextoBusqueda,
  ETIQUETAS_EXPEDIENTE,
  ETIQUETAS_UBICACION,
  normalizarFechaISO,
} from './precarga';

describe('parsearValoresPrecarga', () => {
  const ejemploBackOffice = JSON.stringify([
    { id_pregunta: 2, etiqueta: 'DPI', valor: '56875745360901' },
    { id_pregunta: 3, etiqueta: 'Nombres', valor: 'Iván Esteban' },
  ]);

  it('interpreta el ejemplo literal del BackOffice y pasa el id a texto', () => {
    expect(parsearValoresPrecarga(ejemploBackOffice)).toEqual([
      { id_pregunta: '2', etiqueta: 'DPI', valor: '56875745360901' },
      { id_pregunta: '3', etiqueta: 'Nombres', valor: 'Iván Esteban' },
    ]);
  });

  it('acepta el array ya deserializado, no solo la cadena', () => {
    expect(parsearValoresPrecarga(JSON.parse(ejemploBackOffice))).toHaveLength(2);
  });

  // Un throw aquí abortaría la sincronización de TODA la cartera por una fila mal escrita.
  it.each([
    ['JSON inválido', '[{no es json}'],
    ['cadena vacía', ''],
    ['solo espacios', '   '],
    ['nulo', null],
    ['indefinido', undefined],
    ['objeto en vez de array', '{"id_pregunta":1}'],
    ['número', 42],
  ])('devuelve lista vacía sin lanzar ante %s', (_caso, entrada) => {
    expect(() => parsearValoresPrecarga(entrada)).not.toThrow();
    expect(parsearValoresPrecarga(entrada)).toEqual([]);
  });

  it('descarta entradas sin id o sin valor, conservando las sanas', () => {
    const mixto = JSON.stringify([
      { etiqueta: 'Sin id', valor: 'x' },
      { id_pregunta: 7, etiqueta: 'Sin valor' },
      { id_pregunta: 9, etiqueta: 'Buena', valor: 'sí' },
      null,
      'texto suelto',
    ]);
    expect(parsearValoresPrecarga(mixto)).toEqual([
      { id_pregunta: '9', etiqueta: 'Buena', valor: 'sí' },
    ]);
  });

  it('tolera las variantes camelCase y PascalCase del id', () => {
    const variantes = JSON.stringify([
      { idPregunta: 4, etiqueta: 'A', valor: '1' },
      { IdPregunta: 5, Etiqueta: 'B', Valor: '2' },
    ]);
    expect(parsearValoresPrecarga(variantes).map((v) => v.id_pregunta)).toEqual(['4', '5']);
  });

  it('conserva un valor vacío como cadena, sin confundirlo con ausencia', () => {
    expect(parsearValoresPrecarga('[{"id_pregunta":1,"etiqueta":"A","valor":""}]')).toEqual([
      { id_pregunta: '1', etiqueta: 'A', valor: '' },
    ]);
  });
});

describe('resolverEtiqueta', () => {
  const valores = [
    { id_pregunta: '1', etiqueta: 'Ubicación', valor: 'Aldea Chuisuc' },
    { id_pregunta: '2', etiqueta: 'CÓDIGO DE EXPEDIENTE', valor: 'EXP-2026-00412' },
    { id_pregunta: '3', etiqueta: 'Codigo', valor: 'NO-DEBE-GANAR' },
  ];

  it('compara sin acentos ni mayúsculas en ambos lados', () => {
    expect(resolverEtiqueta(valores, ETIQUETAS_UBICACION)).toBe('Aldea Chuisuc');
  });

  it('respeta el orden de preferencia de las candidatas, no el de los valores', () => {
    // 'codigo de expediente' va antes que 'codigo' en la lista, aunque en `valores`
    // aparezca después: si mandara el orden de los valores saldría NO-DEBE-GANAR.
    expect(resolverEtiqueta(valores, ETIQUETAS_EXPEDIENTE)).toBe('EXP-2026-00412');
  });

  it('devuelve null cuando ninguna candidata casa', () => {
    expect(resolverEtiqueta(valores, ['nada de nada'])).toBeNull();
  });

  it('ignora un valor presente pero en blanco y sigue buscando', () => {
    const conBlanco = [
      { id_pregunta: '1', etiqueta: 'Ubicacion', valor: '   ' },
      { id_pregunta: '2', etiqueta: 'Comunidad', valor: 'Chuisuc' },
    ];
    expect(resolverEtiqueta(conBlanco, ETIQUETAS_UBICACION)).toBe('Chuisuc');
  });

  it('devuelve null con la lista de valores vacía', () => {
    expect(resolverEtiqueta([], ETIQUETAS_UBICACION)).toBeNull();
  });
});

describe('construirTextoBusqueda', () => {
  it('normaliza y concatena solo los campos presentes', () => {
    expect(
      construirTextoBusqueda({
        documento: '2588741250901',
        nombres: 'María Elena Coc',
        cuenta: null,
        operacion: '77120',
      }),
    ).toBe('2588741250901 maria elena coc 77120');
  });

  it('devuelve cadena vacía si no hay ningún campo', () => {
    expect(
      construirTextoBusqueda({ documento: null, nombres: null, cuenta: null, operacion: null }),
    ).toBe('');
  });
});

describe('enriquecerConEtiquetas (forma REAL del servicio)', () => {
  // Payload copiado tal cual de GET /api/onesiteex/precarga (2026-09-07). A diferencia
  // del Excel de especificación, NO trae 'etiqueta': por eso hace falta el cruce local.
  const valoresReales = JSON.stringify([
    { id: null, id_pregunta: '289', id_encuesta: '5', valor: 'TEST-002', uuid_instancia: null, estado_sincro: -1, fecha_inicio: null, fecha_fin: null },
    { id: null, id_pregunta: '287', id_encuesta: '5', valor: '1111111110502', uuid_instancia: null, estado_sincro: -1, fecha_inicio: null, fecha_fin: null },
  ]);

  const catalogo = new Map([['287', 'DPI'], ['289', 'Código cliente'], ['290', 'DEPARTAMENTO']]);

  it('resuelve el expediente cruzando id_pregunta con las etiquetas locales', () => {
    const enriquecidos = enriquecerConEtiquetas(parsearValoresPrecarga(valoresReales), catalogo);
    expect(resolverEtiqueta(enriquecidos, ETIQUETAS_EXPEDIENTE)).toBe('TEST-002');
  });

  it('sin catálogo local no inventa nada: el expediente queda sin resolver', () => {
    const sinCruzar = parsearValoresPrecarga(valoresReales);
    expect(resolverEtiqueta(sinCruzar, ETIQUETAS_EXPEDIENTE)).toBeNull();
  });

  it('una etiqueta que sí manda el servidor gana sobre la local', () => {
    const conEtiqueta = parsearValoresPrecarga(
      JSON.stringify([{ id_pregunta: '287', etiqueta: 'Expediente', valor: 'EXP-9' }]),
    );
    const enriquecidos = enriquecerConEtiquetas(conEtiqueta, catalogo);
    expect(enriquecidos[0].etiqueta).toBe('Expediente');
  });

  it('un id_pregunta ausente del catálogo no rompe el resto', () => {
    const enriquecidos = enriquecerConEtiquetas(parsearValoresPrecarga(valoresReales), new Map([['289', 'Código cliente']]));
    expect(enriquecidos).toHaveLength(2);
    expect(resolverEtiqueta(enriquecidos, ETIQUETAS_EXPEDIENTE)).toBe('TEST-002');
  });
});

describe('esNombreMarcador', () => {
  it('reconoce los rellenos que pone la propia app', () => {
    expect(esNombreMarcador('CLIENTE SIN NOMBRE')).toBe(true);
    expect(esNombreMarcador('NUEVA ENCUESTA')).toBe(true);
    expect(esNombreMarcador('')).toBe(true);
    expect(esNombreMarcador(null)).toBe(true);
  });

  it('trata el documento como marcador: la tarjeta lo usa de sustituto', () => {
    expect(esNombreMarcador('1111111110401', '1111111110401')).toBe(true);
  });

  it('un nombre real no es marcador aunque haya documento', () => {
    expect(esNombreMarcador('ZOILA TEC', '1111111110401')).toBe(false);
  });

  // Regresión del ciclo completo: capturar el nombre y luego pulsar 'Cargar datos'
  // NO debe devolver la tarjeta al valor con el que llegó de la precarga.
  it('la recarga conserva el nombre local cuando el servidor solo trae un marcador', () => {
    const delServidor = { nombre: 'CLIENTE SIN NOMBRE', documento: null };
    const local = { nombre: 'ZOILA TEC', documento: null };
    const conservar =
      esNombreMarcador(delServidor.nombre, delServidor.documento) &&
      !esNombreMarcador(local.nombre, local.documento);
    expect(conservar).toBe(true);
  });

  it('pero SÍ se actualiza cuando el servidor manda un nombre real', () => {
    const delServidor = { nombre: 'PACO VARGAS', documento: null };
    const local = { nombre: 'ZOILA TEC', documento: null };
    const conservar =
      esNombreMarcador(delServidor.nombre, delServidor.documento) &&
      !esNombreMarcador(local.nombre, local.documento);
    expect(conservar).toBe(false);
  });
});

describe('normalizarFechaISO', () => {
  it('convierte DD/MM/YYYY del BackOffice a YYYY-MM-DD', () => {
    expect(normalizarFechaISO('01/01/1980')).toBe('1980-01-01');
    expect(normalizarFechaISO('9/3/1979')).toBe('1979-03-09');
  });
  it('deja intacto YYYY-MM-DD', () => {
    expect(normalizarFechaISO('1980-01-01')).toBe('1980-01-01');
  });
  it('toma la parte de fecha de un datetime ISO', () => {
    expect(normalizarFechaISO('1980-01-01T00:00:00.000Z')).toBe('1980-01-01');
    expect(normalizarFechaISO('1980-01-01T06:30:00')).toBe('1980-01-01');
  });
  it('acepta día-primero con guiones', () => {
    expect(normalizarFechaISO('01-01-1980')).toBe('1980-01-01');
  });
  it('devuelve null ante basura o vacío (no revienta el input)', () => {
    expect(normalizarFechaISO('')).toBeNull();
    expect(normalizarFechaISO(null)).toBeNull();
    expect(normalizarFechaISO('no-es-fecha')).toBeNull();
    expect(normalizarFechaISO('32/13/2020')).toBeNull();
  });
});
