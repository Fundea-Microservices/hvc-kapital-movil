import { AxiosError, AxiosHeaders } from 'axios';

import { clasificarError } from './multimediaUploader';

/**
 * Construye un AxiosError con el estado indicado, o sin respuesta si es `null`.
 * Se usa el constructor real y no un objeto literal porque `clasificarError` filtra
 * con `axios.isAxiosError`, que comprueba una marca interna.
 */
const errorHttp = (estado: number | null, mensaje = 'fallo'): AxiosError => {
  const error = new AxiosError(mensaje);
  if (estado !== null) {
    error.response = {
      status: estado,
      statusText: '',
      data: { message: mensaje },
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    };
  }
  return error;
};

describe('clasificarError — decide si un archivo se reintenta', () => {
  it('409 cuenta como SUBIDO: el indice unico del servidor hizo su trabajo', () => {
    // El archivo llego pero se perdio el ACK. Reintentarlo acumularia copias.
    expect(clasificarError(errorHttp(409)).clase).toBe('SUBIDO');
  });

  it.each([403, 404, 413, 415, 422])(
    'HTTP %i es RECHAZADO: reintentar no cambiara nada',
    estado => {
      // Un archivo que pesa de mas o con extension prohibida consumiria el cupo de
      // cada ciclo y dejaria fuera a los que si podrian subir.
      expect(clasificarError(errorHttp(estado)).clase).toBe('RECHAZADO');
    },
  );

  it('503 es ESPERAR y NO consume intentos', () => {
    // El servidor dice que su almacenamiento no esta configurado. Si contara como
    // reintento, cinco sincronizaciones bastarian para marcar como rechazada toda la
    // evidencia de campo por una variable de entorno que nadie ha tocado aun.
    expect(clasificarError(errorHttp(503)).clase).toBe('ESPERAR');
  });

  it('sin respuesta es REINTENTABLE: no hubo red', () => {
    // El caso mas frecuente en campo. Marcarlo rechazado destruiria evidencia
    // perfectamente recuperable.
    expect(clasificarError(errorHttp(null)).clase).toBe('REINTENTABLE');
  });

  it.each([401, 500, 502, 504])('HTTP %i es REINTENTABLE', estado => {
    // 401 lo resuelve el proximo ciclo con un token fresco; 5xx es del servidor.
    expect(clasificarError(errorHttp(estado)).clase).toBe('REINTENTABLE');
  });

  it('un error que no es de axios se trata como reintentable', () => {
    expect(clasificarError(new Error('algo raro')).clase).toBe('REINTENTABLE');
    expect(clasificarError('texto suelto').clase).toBe('REINTENTABLE');
  });

  it('el detalle conserva el mensaje del servidor para diagnostico', () => {
    const { detalle } = clasificarError(errorHttp(413, 'El archivo supera el limite'));
    expect(detalle).toContain('413');
    expect(detalle).toContain('El archivo supera el limite');
  });

  it('NINGUN estado desconocido se clasifica como RECHAZADO por accidente', () => {
    // Regla de seguridad: ante la duda, se conserva el archivo. Solo la lista
    // explicita de estados definitivos puede descartar evidencia.
    [418, 429, 451, 507].forEach(estado => {
      expect(clasificarError(errorHttp(estado)).clase).not.toBe('RECHAZADO');
    });
  });
});
