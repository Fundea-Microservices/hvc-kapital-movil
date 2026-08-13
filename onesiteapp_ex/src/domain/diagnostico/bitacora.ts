/**
 * Reglas de la bitácora de errores.
 *
 * POR QUÉ EXISTE ESTA BITÁCORA
 * Cuando la aplicación falla en campo —sin señal, en un caserío, a tres horas de la
 * agencia— nadie se entera. El asesor reporta "no funciona" días después y no queda
 * rastro de qué ocurrió. Esta bitácora guarda el error en el dispositivo y lo envía en
 * la siguiente sincronización, sin depender de ningún servicio externo.
 *
 * POR QUÉ NO SENTRY
 * Decisión del equipo: sin dependencias nativas (no obliga a recompilar), funciona
 * offline —que es el escenario real, no la excepción— y los datos no salen de la
 * infraestructura de FUNDEA.
 *
 * ESTE MÓDULO ES PURO A PROPÓSITO
 * El saneado es lo único que impide que la bitácora se convierta en una fuga de datos
 * personales o de credenciales, así que tiene que ser verificable sin dispositivo.
 */

/** Niveles admitidos. `ERROR` interrumpió algo; `WARN` es degradación tolerada. */
export type NivelBitacora = 'ERROR' | 'WARN';

export interface EntradaBitacora {
  nivel: NivelBitacora;
  /** Punto del código que lo registró: `syncManager.FASE1`, `multimedia.subida`… */
  origen: string;
  mensaje: string;
  detalle: string | null;
  contexto: Record<string, string | number | boolean | null> | null;
}

/** Topes. Un dispositivo puede pasar semanas sin señal acumulando entradas. */
export const LONGITUD_MAXIMA_MENSAJE = 300;
export const LONGITUD_MAXIMA_DETALLE = 2000;
export const MAXIMO_FILAS = 500;
export const DIAS_RETENCION = 30;

/**
 * Fragmentos que delatan una credencial. Se sustituyen por una marca antes de
 * persistir: un token de sesión en la bitácora acaba en la base del servidor, en los
 * respaldos y en cualquier consulta de soporte.
 */
const PATRONES_SENSIBLES: readonly RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,      // encabezado Authorization
  /eyJ[A-Za-z0-9._-]{10,}/g,               // JWT (siempre empieza por eyJ)
  /"?(password|contrasena|contraseña|pwd|token|refreshToken|deviceToken|apiKey)"?\s*[:=]\s*"?[^",;\s}]+/gi,
];

export const MARCA_REDACTADO = '[REDACTADO]';

/**
 * Elimina credenciales y recorta. Se aplica SIEMPRE antes de persistir, incluso a
 * textos que "obviamente" no llevan nada: el día que alguien registre el cuerpo de una
 * petición fallida, esta función es lo único que impide que el token viaje con él.
 */
export const sanearTexto = (texto: string | null | undefined, limite: number): string => {
  let limpio = String(texto ?? '');

  for (const patron of PATRONES_SENSIBLES) {
    limpio = limpio.replace(patron, MARCA_REDACTADO);
  }

  // Los saltos de línea se conservan como espacio: un stack trace de 40 líneas no
  // aporta más que las primeras, y en una sola línea es legible en cualquier consulta.
  limpio = limpio.replace(/\s+/g, ' ').trim();

  return limpio.length > limite ? `${limpio.slice(0, limite)}…` : limpio;
};

/**
 * Extrae un mensaje legible de cualquier cosa que llegue a un `catch`.
 * TypeScript tipa el error como `unknown` y en la práctica puede ser un `Error`, un
 * `AxiosError`, un string, o un objeto sin forma conocida.
 */
export const mensajeDe = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name || 'Error sin mensaje';
  if (typeof error === 'string') return error;

  if (typeof error === 'object' && error !== null) {
    const posible = error as { message?: unknown };
    if (typeof posible.message === 'string' && posible.message.trim() !== '') {
      return posible.message;
    }
  }

  return 'Error desconocido';
};

/** Pila de llamadas, si la hay. */
export const detalleDe = (error: unknown): string | null => {
  if (error instanceof Error && typeof error.stack === 'string') return error.stack;
  return null;
};

/**
 * Contexto adicional que acompaña al error (id de encuesta, ruta del archivo…).
 *
 * **Solo se admiten valores escalares y NUNCA respuestas del encuestado.** El contexto
 * está para localizar el fallo, no para reproducir la captura: `local_captura.valor`
 * contiene nombres, direcciones y montos de una persona real, y esto viaja al servidor
 * y queda en sus respaldos.
 */
export const sanearContexto = (
  contexto: Record<string, unknown> | null | undefined,
): Record<string, string | number | boolean | null> | null => {
  if (!contexto || typeof contexto !== 'object') return null;

  const salida: Record<string, string | number | boolean | null> = {};

  for (const [clave, valor] of Object.entries(contexto)) {
    if (valor === null || valor === undefined) {
      salida[clave] = null;
      continue;
    }
    if (typeof valor === 'number' || typeof valor === 'boolean') {
      salida[clave] = valor;
      continue;
    }
    // Todo lo demás se convierte a texto y se sanea. Los objetos anidados se
    // descartan: invitarían a volcar la respuesta completa "por si acaso".
    if (typeof valor === 'string') {
      salida[clave] = sanearTexto(valor, 200);
    }
  }

  return Object.keys(salida).length > 0 ? salida : null;
};

/** Construye la entrada lista para persistir. Punto único de saneado. */
export const construirEntrada = (
  nivel: NivelBitacora,
  origen: string,
  error: unknown,
  contexto?: Record<string, unknown> | null,
): EntradaBitacora => ({
  nivel,
  origen: sanearTexto(origen, 80) || 'desconocido',
  mensaje: sanearTexto(mensajeDe(error), LONGITUD_MAXIMA_MENSAJE) || 'Error desconocido',
  detalle: (() => {
    const bruto = detalleDe(error);
    if (!bruto) return null;
    const limpio = sanearTexto(bruto, LONGITUD_MAXIMA_DETALLE);
    return limpio === '' ? null : limpio;
  })(),
  contexto: sanearContexto(contexto),
});

/**
 * Decide qué entradas se descartan al superar el tope.
 *
 * Se conservan las MÁS RECIENTES: un error que se repite cientos de veces llenaría la
 * tabla con copias del mismo problema y expulsaría a los demás. Recibe las entradas ya
 * ordenadas de más antigua a más reciente y devuelve cuántas hay que borrar.
 */
export const excedenteAPodar = (totalFilas: number, maximo = MAXIMO_FILAS): number =>
  totalFilas > maximo ? totalFilas - maximo : 0;

/** Epoch a partir del cual una entrada se considera caducada. */
export const epochDeCaducidad = (ahoraMs: number, dias = DIAS_RETENCION): number =>
  ahoraMs - dias * 24 * 60 * 60 * 1000;
