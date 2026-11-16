/**
 * Lectura del sobre de respuesta del API de HVC Kapital (puerto 3200).
 *
 * Todas sus rutas responden `{ success, statusCode, message, data, metadata }`,
 * a diferencia del microservicio de encuestas (5030), que devuelve el objeto
 * plano. Mientras la app hable con los dos backends, esta función marca la
 * frontera: lo que pasa por aquí viene del API nuevo.
 */

/** Sobre del API. `data` es `unknown` a propósito: se valida al desempacar. */
export interface SobreApi {
  success?: boolean;
  statusCode?: number | string;
  message?: string;
  data?: unknown;
  metadata?: unknown;
}

/**
 * Devuelve `data` del sobre, o lanza si la respuesta no tiene la forma esperada.
 *
 * Lanza en vez de devolver `null` porque quien llama necesita el dato para
 * continuar: un token o un deviceToken ausente deja la sesión inservible, y es
 * preferible fallar donde se origina que arrastrar un `undefined` hasta la UI.
 */
export const extraerData = <T>(cuerpo: unknown, contexto: string): T => {
  if (typeof cuerpo !== 'object' || cuerpo === null) {
    throw new Error(`${contexto}: el servidor no devolvió un objeto`);
  }

  const sobre = cuerpo as SobreApi;

  if (sobre.success === false) {
    throw new Error(sobre.message || `${contexto}: el servidor rechazó la petición`);
  }

  if (sobre.data === undefined || sobre.data === null) {
    throw new Error(`${contexto}: la respuesta no trae datos`);
  }

  return sobre.data as T;
};

/**
 * Igual que `extraerData` pero admite respuestas sin datos (logout, metadatos).
 * Devuelve el mensaje del servidor para poder mostrarlo tal cual.
 */
export const extraerMensaje = (cuerpo: unknown, porDefecto: string): string => {
  if (typeof cuerpo !== 'object' || cuerpo === null) return porDefecto;
  return (cuerpo as SobreApi).message || porDefecto;
};
