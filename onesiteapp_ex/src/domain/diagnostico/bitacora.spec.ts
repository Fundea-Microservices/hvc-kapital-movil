import {
  construirEntrada,
  detalleDe,
  epochDeCaducidad,
  excedenteAPodar,
  LONGITUD_MAXIMA_DETALLE,
  LONGITUD_MAXIMA_MENSAJE,
  MARCA_REDACTADO,
  mensajeDe,
  sanearContexto,
  sanearTexto,
} from './bitacora';

describe('sanearTexto — la bitacora NO puede filtrar credenciales', () => {
  it('redacta un encabezado Authorization', () => {
    const texto = 'Fallo con Bearer abc123.def456-ghi789 al subir';
    const limpio = sanearTexto(texto, 500);
    expect(limpio).toContain(MARCA_REDACTADO);
    expect(limpio).not.toContain('abc123');
  });

  it('redacta un JWT suelto', () => {
    // Un token de sesion en la bitacora acaba en la base del servidor, en sus
    // respaldos y en cualquier consulta de soporte.
    const texto = 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.cuerpo.firma';
    const limpio = sanearTexto(texto, 500);
    expect(limpio).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(limpio).toContain(MARCA_REDACTADO);
  });

  it.each(['password', 'contrasena', 'pwd', 'token', 'refreshToken', 'deviceToken', 'apiKey'])(
    'redacta el campo %s aunque venga dentro de un JSON',
    campo => {
      const limpio = sanearTexto(`{"${campo}":"valorSecreto123"}`, 500);
      expect(limpio).not.toContain('valorSecreto123');
    },
  );

  it('colapsa los saltos de linea del stack en una sola linea', () => {
    expect(sanearTexto('a\n  b\n\tc', 500)).toBe('a b c');
  });

  it('recorta al limite y marca que se corto', () => {
    const largo = 'x'.repeat(1000);
    const limpio = sanearTexto(largo, 100);
    expect(limpio.length).toBe(101); // 100 + el caracter de continuacion
    expect(limpio.endsWith('…')).toBe(true);
  });

  it('tolera null y undefined', () => {
    expect(sanearTexto(null, 100)).toBe('');
    expect(sanearTexto(undefined, 100)).toBe('');
  });
});

describe('mensajeDe — un catch recibe cualquier cosa', () => {
  it('extrae el mensaje de un Error', () => {
    expect(mensajeDe(new Error('sin red'))).toBe('sin red');
  });

  it('acepta un string suelto', () => {
    expect(mensajeDe('algo fallo')).toBe('algo fallo');
  });

  it('acepta un objeto con message, como los errores de axios', () => {
    expect(mensajeDe({ message: 'Request failed' })).toBe('Request failed');
  });

  it('nunca devuelve vacio', () => {
    [null, undefined, 42, {}, []].forEach(v => {
      expect(mensajeDe(v).length).toBeGreaterThan(0);
    });
  });

  it('un Error sin mensaje cae a su nombre', () => {
    const e = new TypeError('');
    expect(mensajeDe(e)).toBe('TypeError');
  });
});

describe('detalleDe', () => {
  it('devuelve el stack de un Error', () => {
    expect(detalleDe(new Error('x'))).toContain('Error');
  });

  it('devuelve null para lo que no es Error', () => {
    expect(detalleDe('texto')).toBeNull();
    expect(detalleDe({ message: 'x' })).toBeNull();
  });
});

describe('sanearContexto — nunca datos del encuestado', () => {
  it('conserva escalares', () => {
    expect(sanearContexto({ idEncuesta: 3, reintento: true, ruta: 'multimedia/x.jpg' }))
      .toEqual({ idEncuesta: 3, reintento: true, ruta: 'multimedia/x.jpg' });
  });

  it('DESCARTA objetos anidados', () => {
    // Admitirlos invitaria a volcar la respuesta completa "por si acaso", y
    // local_captura.valor lleva nombres, direcciones y montos de una persona real.
    expect(sanearContexto({ respuestas: { p1: 'Juan Perez' }, id: 1 })).toEqual({ id: 1 });
  });

  it('sanea tambien los valores de texto del contexto', () => {
    const limpio = sanearContexto({ cabecera: 'Bearer secreto123' });
    expect(limpio?.cabecera).toContain(MARCA_REDACTADO);
  });

  it('null y undefined dan null', () => {
    expect(sanearContexto(null)).toBeNull();
    expect(sanearContexto(undefined)).toBeNull();
    expect(sanearContexto({})).toBeNull();
  });
});

describe('construirEntrada', () => {
  it('arma la entrada completa desde un Error', () => {
    const entrada = construirEntrada('ERROR', 'syncManager.FASE1', new Error('fallo'), { id: 7 });
    expect(entrada.nivel).toBe('ERROR');
    expect(entrada.origen).toBe('syncManager.FASE1');
    expect(entrada.mensaje).toBe('fallo');
    expect(entrada.detalle).toContain('Error');
    expect(entrada.contexto).toEqual({ id: 7 });
  });

  it('respeta los topes de longitud', () => {
    const enorme = new Error('m'.repeat(5000));
    enorme.stack = 's'.repeat(9000);
    const entrada = construirEntrada('ERROR', 'x', enorme);
    expect(entrada.mensaje.length).toBeLessThanOrEqual(LONGITUD_MAXIMA_MENSAJE + 1);
    expect((entrada.detalle ?? '').length).toBeLessThanOrEqual(LONGITUD_MAXIMA_DETALLE + 1);
  });

  it('nunca deja mensaje ni origen vacios', () => {
    const entrada = construirEntrada('WARN', '', {}, null);
    expect(entrada.origen).toBe('desconocido');
    expect(entrada.mensaje).toBe('Error desconocido');
  });

  it('sanea el mensaje, no solo el detalle', () => {
    const entrada = construirEntrada('ERROR', 'red', new Error('fallo con Bearer tok123'));
    expect(entrada.mensaje).not.toContain('tok123');
  });
});

describe('poda', () => {
  it('solo poda cuando se supera el tope', () => {
    expect(excedenteAPodar(400, 500)).toBe(0);
    expect(excedenteAPodar(500, 500)).toBe(0);
    expect(excedenteAPodar(620, 500)).toBe(120);
  });

  it('la caducidad se calcula hacia atras desde ahora', () => {
    const ahora = 1_000_000_000_000;
    const limite = epochDeCaducidad(ahora, 30);
    expect(ahora - limite).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
