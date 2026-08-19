import {
  construirNombreArchivo,
  construirRutaRelativa,
  esNombreSeguro,
  esRutaContenida,
  hashClaveInstancia,
  normalizarExtension,
  validarPeso,
  validarTipo,
} from './multimedia.politicas';

describe('construirNombreArchivo', () => {
  it('produce exactamente el nombre del requisito: 1-1-20.jpg', () => {
    expect(
      construirNombreArchivo(
        { idEncuesta: 1, idCaptura: '1', idPregunta: 20 },
        'jpg',
      ),
    ).toBe('1-1-20.jpg');
  });

  it('soporta un IdCaptura mayor que el entero seguro de JavaScript', () => {
    // BIGINT de SQL Server. Si se manejara como number, el id se redondearia y el
    // archivo quedaria colgando de OTRA captura.
    const enorme = '9007199254740993';
    expect(
      construirNombreArchivo(
        { idEncuesta: 3, idCaptura: enorme, idPregunta: 7 },
        'pdf',
      ),
    ).toBe(`3-${enorme}-7.pdf`);
  });

  it('anade un sufijo estable para las filas de matriz', () => {
    const fila1 = construirNombreArchivo(
      {
        idEncuesta: 1,
        idCaptura: '1',
        idPregunta: 20,
        claveInstancia: 'uuid-a_uuid-1',
      },
      'jpg',
    );
    const fila2 = construirNombreArchivo(
      {
        idEncuesta: 1,
        idCaptura: '1',
        idPregunta: 20,
        claveInstancia: 'uuid-a_uuid-2',
      },
      'jpg',
    );

    expect(fila1).not.toBe(fila2);
    // Determinista: el mismo reintento produce la misma ruta, base de la idempotencia.
    expect(fila1).toBe(
      construirNombreArchivo(
        {
          idEncuesta: 1,
          idCaptura: '1',
          idPregunta: 20,
          claveInstancia: 'uuid-a_uuid-1',
        },
        'jpg',
      ),
    );
    expect(esNombreSeguro(fila1)).toBe(true);
  });

  it('solo anade la secuencia a partir del segundo archivo', () => {
    const base = { idEncuesta: 1, idCaptura: '1', idPregunta: 20 };
    expect(construirNombreArchivo({ ...base, secuencia: 1 }, 'jpg')).toBe(
      '1-1-20.jpg',
    );
    expect(construirNombreArchivo({ ...base, secuencia: 2 }, 'jpg')).toBe(
      '1-1-20-s2.jpg',
    );
  });

  it('normaliza la extension que llega con punto o en mayusculas', () => {
    const base = { idEncuesta: 1, idCaptura: '1', idPregunta: 20 };
    expect(construirNombreArchivo(base, '.JPG')).toBe('1-1-20.jpg');
  });

  it('lanza en vez de escribir un archivo sin extension valida', () => {
    const base = { idEncuesta: 1, idCaptura: '1', idPregunta: 20 };
    expect(() => construirNombreArchivo(base, '../sh')).toThrow();
    expect(() => construirNombreArchivo(base, '')).toThrow();
  });

  it('el nombre generado SIEMPRE es seguro, con cualquier clave de instancia', () => {
    ['../../etc/passwd', 'a\\b', 'x\0y', '..', '  ', 'z'.repeat(500)].forEach(
      (clave) => {
        const nombre = construirNombreArchivo(
          {
            idEncuesta: 1,
            idCaptura: '1',
            idPregunta: 20,
            claveInstancia: clave,
          },
          'jpg',
        );
        expect(esNombreSeguro(nombre)).toBe(true);
      },
    );
  });
});

describe('hashClaveInstancia', () => {
  it('devuelve vacio cuando no hay fila de matriz', () => {
    expect(hashClaveInstancia(null)).toBe('');
    expect(hashClaveInstancia(undefined)).toBe('');
    expect(hashClaveInstancia('')).toBe('');
  });

  it('siempre 8 caracteres hexadecimales', () => {
    ['a', 'uuid-a_uuid-b', 'x'.repeat(300)].forEach((v) =>
      expect(hashClaveInstancia(v)).toMatch(/^[0-9a-f]{8}$/),
    );
  });
});

describe('esNombreSeguro', () => {
  it('rechaza la bateria clasica de path traversal', () => {
    [
      '../../etc/passwd',
      '..',
      '.',
      '../x.jpg',
      'a/b.jpg',
      'a\\b.jpg',
      'foto.jpg\0.exe',
      '.oculto.jpg',
      'a..b.jpg',
      '/etc/passwd',
      'C:\\x.jpg',
      '',
      null,
      undefined,
      'z'.repeat(200),
      'con espacios.jpg',
      'ñ.jpg',
    ].forEach((n) => expect(esNombreSeguro(n)).toBe(false));
  });

  it('rechaza los nombres reservados de Windows', () => {
    ['CON.pdf', 'con.pdf', 'NUL.jpg', 'LPT1.docx', 'aux.txt'].forEach((n) =>
      expect(esNombreSeguro(n)).toBe(false),
    );
  });

  it('acepta los nombres que el propio generador produce', () => {
    [
      '1-1-20.jpg',
      '1-1-20-3f2a9c01.jpg',
      '3-9007199254740993-7-s2.pdf',
    ].forEach((n) => expect(esNombreSeguro(n)).toBe(true));
  });
});

describe('esRutaContenida', () => {
  it('acepta lo que cuelga de la raiz', () => {
    expect(esRutaContenida('/datos/encuesta-1/x.jpg', '/datos')).toBe(true);
    expect(esRutaContenida('/datos', '/datos')).toBe(true);
    expect(esRutaContenida('/datos/x.jpg', '/datos/')).toBe(true);
  });

  it('RECHAZA el falso positivo de prefijo', () => {
    // El fallo que se escapa siempre: startsWith a secas dejaria pasar esto.
    expect(esRutaContenida('/datos-viejos/secreto.pdf', '/datos')).toBe(false);
    expect(esRutaContenida('/datosprivados/x.jpg', '/datos')).toBe(false);
  });

  it('rechaza rutas fuera de la raiz y entradas vacias', () => {
    expect(esRutaContenida('/etc/passwd', '/datos')).toBe(false);
    expect(esRutaContenida('', '/datos')).toBe(false);
    expect(esRutaContenida('/datos/x.jpg', '')).toBe(false);
  });

  it('en Windows ignora mayusculas y usa la barra invertida', () => {
    expect(
      esRutaContenida('C:\\Datos\\encuesta-1\\x.jpg', 'c:\\datos', '\\'),
    ).toBe(true);
    expect(esRutaContenida('C:\\Datos-viejos\\x.jpg', 'C:\\Datos', '\\')).toBe(
      false,
    );
  });
});

describe('validarTipo', () => {
  const imagenes = ['jpg', 'jpeg', 'png', 'heic'];

  it('acepta lo que esta en la lista blanca', () => {
    expect(validarTipo('JPG', imagenes).valido).toBe(true);
    expect(validarTipo('.png', imagenes).valido).toBe(true);
  });

  it('rechaza lo que no esta, aunque sea inofensivo', () => {
    expect(validarTipo('gif', imagenes).valido).toBe(false);
  });

  it('rechaza las extensiones prohibidas AUNQUE esten mal configuradas en el .env', () => {
    // Segunda linea de defensa: un administrador podria anadir svg sin saber que
    // un SVG ejecuta JavaScript al abrirlo.
    ['svg', 'html', 'js', 'exe', 'php'].forEach((ext) =>
      expect(validarTipo(ext, [...imagenes, ext]).valido).toBe(false),
    );
  });

  it('sin lista configurada no acepta nada', () => {
    // Preferible un rechazo visible a aceptar cualquier cosa porque falto una
    // variable de entorno.
    expect(validarTipo('jpg', []).valido).toBe(false);
  });

  it('rechaza extensiones ausentes o con caracteres raros', () => {
    ['', null, undefined, '../sh', 'jp g', 'z'.repeat(20)].forEach((ext) =>
      expect(validarTipo(ext, imagenes).valido).toBe(false),
    );
  });
});

describe('validarPeso', () => {
  it('acepta exactamente el limite', () => {
    expect(validarPeso(5 * 1024 * 1024, 5120).valido).toBe(true);
  });

  it('rechaza un solo byte por encima', () => {
    expect(validarPeso(5 * 1024 * 1024 + 1, 5120).valido).toBe(false);
  });

  it('rechaza el archivo vacio', () => {
    expect(validarPeso(0, 5120).valido).toBe(false);
    expect(validarPeso(NaN, 5120).valido).toBe(false);
  });
});

describe('construirRutaRelativa', () => {
  it('particiona por encuesta y captura', () => {
    expect(
      construirRutaRelativa(
        { idEncuesta: 1, idCaptura: '1', idPregunta: 20 },
        'jpg',
      ),
    ).toBe('encuesta-1/captura-1/1-1-20.jpg');
  });

  it('respeta el separador del sistema de archivos', () => {
    expect(
      construirRutaRelativa(
        { idEncuesta: 1, idCaptura: '1', idPregunta: 20 },
        'jpg',
        '\\',
      ),
    ).toBe('encuesta-1\\captura-1\\1-1-20.jpg');
  });
});

describe('normalizarExtension', () => {
  it('quita puntos, espacios y mayusculas', () => {
    expect(normalizarExtension('  .JPEG ')).toBe('jpeg');
  });

  it('devuelve vacio ante cualquier cosa que no sea alfanumerica', () => {
    ['', null, undefined, '..', 'a/b', 'a b', 'a-b'].forEach((e) =>
      expect(normalizarExtension(e)).toBe(''),
    );
  });
});
