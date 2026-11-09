import {
  debeEnviarseRechazo,
  normalizarOrigen,
  esPayloadCoherente,
  clasificarFallo,
  recortarMotivo,
  ENVIO_PENDIENTE,
  ENVIO_ERROR_REINTENTABLE,
  ENVIO_ENVIADO,
  ENVIO_DEFINITIVO,
  MAX_INTENTOS_RECHAZO,
  MAX_LONGITUD_MOTIVO,
  FilaRechazable,
} from './rechazo';

const fila = (parcial: Partial<FilaRechazable> = {}): FilaRechazable => ({
  estado_gestion: 2,
  origen: 'PRECARGA',
  motivo_rechazo: 'Cliente no localizado',
  rechazo_envio_estado: ENVIO_PENDIENTE,
  rechazo_intentos: 0,
  ...parcial,
});

describe('debeEnviarseRechazo', () => {
  it('envía una gestión cancelada con motivo y pendiente de enviar', () => {
    expect(debeEnviarseRechazo(fila())).toBe(true);
  });

  it('reintenta la que quedó en error reintentable', () => {
    expect(
      debeEnviarseRechazo(fila({ rechazo_envio_estado: ENVIO_ERROR_REINTENTABLE })),
    ).toBe(true);
  });

  it('NO reenvía la ya enviada: sellarla es lo que evita el duplicado', () => {
    expect(debeEnviarseRechazo(fila({ rechazo_envio_estado: ENVIO_ENVIADO }))).toBe(false);
  });

  it('NO reintenta la descartada definitivamente', () => {
    expect(debeEnviarseRechazo(fila({ rechazo_envio_estado: ENVIO_DEFINITIVO }))).toBe(
      false,
    );
  });

  it('ignora las pendientes y las completadas: solo viaja lo cancelado', () => {
    expect(debeEnviarseRechazo(fila({ estado_gestion: 0 }))).toBe(false);
    expect(debeEnviarseRechazo(fila({ estado_gestion: 1 }))).toBe(false);
  });

  it('descarta la cancelada SIN motivo en vez de girar por un 400 seguro', () => {
    expect(debeEnviarseRechazo(fila({ motivo_rechazo: null }))).toBe(false);
    expect(debeEnviarseRechazo(fila({ motivo_rechazo: '   ' }))).toBe(false);
  });

  it('entran los DOS orígenes: la AD-HOC ya no queda fuera', () => {
    expect(debeEnviarseRechazo(fila({ origen: 'AD-HOC' }))).toBe(true);
    expect(debeEnviarseRechazo(fila({ origen: 'PRECARGA' }))).toBe(true);
  });
});

describe('normalizarOrigen', () => {
  it('reconoce PRECARGA sin importar espacios ni caja', () => {
    expect(normalizarOrigen(' precarga ')).toBe('PRECARGA');
    expect(normalizarOrigen('PRECARGA')).toBe('PRECARGA');
  });

  it('todo lo demás es AD-HOC, incluida una fila sin origen', () => {
    expect(normalizarOrigen('AD-HOC')).toBe('AD-HOC');
    expect(normalizarOrigen('')).toBe('AD-HOC');
  });
});

describe('esPayloadCoherente', () => {
  it('PRECARGA exige idPrecarga', () => {
    expect(esPayloadCoherente('PRECARGA', '92CEDD06-0000-0000-0000-000000000001')).toBe(
      true,
    );
    expect(esPayloadCoherente('PRECARGA', null)).toBe(false);
    expect(esPayloadCoherente('PRECARGA', '  ')).toBe(false);
  });

  it('AD-HOC exige idPrecarga nulo: esa gestión no existe en pre.Precarga', () => {
    expect(esPayloadCoherente('AD-HOC', null)).toBe(true);
    expect(esPayloadCoherente('AD-HOC', 'algo')).toBe(false);
  });
});

describe('clasificarFallo', () => {
  it('sin respuesta (sin cobertura) es reintentable y suma un intento', () => {
    expect(clasificarFallo(null, 0)).toEqual({
      estado: ENVIO_ERROR_REINTENTABLE,
      intentos: 1,
    });
  });

  it('un 5xx es reintentable: el servidor puede recuperarse', () => {
    expect(clasificarFallo(500, 0).estado).toBe(ENVIO_ERROR_REINTENTABLE);
    expect(clasificarFallo(503, 1).estado).toBe(ENVIO_ERROR_REINTENTABLE);
  });

  it('un 400 es DEFINITIVO: el payload no va a mejorar solo', () => {
    expect(clasificarFallo(400, 0)).toEqual({ estado: ENVIO_DEFINITIVO, intentos: 1 });
    expect(clasificarFallo(404, 0).estado).toBe(ENVIO_DEFINITIVO);
  });

  it('el 401 es la excepción del 4xx: la sesión puede renovarse', () => {
    expect(clasificarFallo(401, 0).estado).toBe(ENVIO_ERROR_REINTENTABLE);
  });

  it('al alcanzar el tope de intentos pasa a definitivo aunque sea red', () => {
    expect(clasificarFallo(null, MAX_INTENTOS_RECHAZO - 1)).toEqual({
      estado: ENVIO_DEFINITIVO,
      intentos: MAX_INTENTOS_RECHAZO,
    });
  });

  it('un 401 repetido tampoco gira para siempre', () => {
    expect(clasificarFallo(401, MAX_INTENTOS_RECHAZO - 1).estado).toBe(ENVIO_DEFINITIVO);
  });
});

describe('recortarMotivo', () => {
  it('recorta al tope de la columna del servidor', () => {
    const largo = 'a'.repeat(MAX_LONGITUD_MOTIVO + 50);
    expect(recortarMotivo(largo)).toHaveLength(MAX_LONGITUD_MOTIVO);
  });

  it('quita espacios y tolera null', () => {
    expect(recortarMotivo('  motivo  ')).toBe('motivo');
    expect(recortarMotivo(null)).toBe('');
  });
});
