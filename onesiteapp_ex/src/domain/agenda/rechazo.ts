/**
 * Reglas del rechazo de gestión ("Cancelar Gestión") — funciones PURAS, sin red,
 * sin WatermelonDB y sin `axios`. Lo que decide si una fila entra a la cola y qué
 * hacer con un fallo vive aquí para poder probarlo sin levantar una base.
 *
 * QUÉ PROBLEMA RESUELVE
 * El rechazo se escribe en el dispositivo al instante (offline-first) y viaja después.
 * La primera versión de ese envío no distinguía un fallo de red de un payload inválido:
 * una fila que el servidor rechazaba con 400 se reintentaba en CADA ciclo de
 * sincronización, para siempre, y cada intento escribía una entrada en
 * `local_bitacora_error` — que tiene tope de 500 filas. Es decir: un solo rechazo mal
 * formado podía desalojar los diagnósticos reales de todo lo demás.
 *
 * LA REGLA
 * Solo se reintenta lo que PUEDE cambiar de resultado: red caída y errores del servidor.
 * Un 4xx describe el payload, y el payload no va a mejorar solo.
 */

/** Estados de la cola de salida. Mismo vocabulario que `local_multimedia.estado_subida`. */
export const ENVIO_PENDIENTE = 0;
export const ENVIO_ERROR_REINTENTABLE = 1;
export const ENVIO_ENVIADO = 2;
export const ENVIO_DEFINITIVO = 3;

/**
 * Intentos máximos antes de dar una fila por perdida. Mismo tope que los adjuntos y la
 * bitácora de errores: tres ciclos de sincronización son suficientes para descartar un
 * problema transitorio, y más solo gasta datos del asesor.
 */
export const MAX_INTENTOS_RECHAZO = 3;

/** Los dos orígenes posibles de una fila de la agenda. */
export type OrigenGestion = 'PRECARGA' | 'AD-HOC';

/**
 * Lo mínimo que necesita saberse de una fila para decidir si se envía. Se declara aquí
 * como interfaz —y no se importa el modelo de WatermelonDB— para que estas funciones se
 * puedan probar con objetos planos.
 */
export interface FilaRechazable {
  estado_gestion: number;
  origen: string;
  motivo_rechazo: string | null;
  rechazo_envio_estado: number;
  rechazo_intentos: number;
}

/**
 * ¿Esta fila tiene un rechazo que deba viajar?
 *
 * Se exige `motivo_rechazo` con contenido: sin motivo no hay nada que persistir, y el
 * servidor lo rechazaría con un 400 que ya no se reintenta. Puede haber filas así entre
 * las históricas (canceladas antes de que el motivo fuese obligatorio), y hacerlas girar
 * en la cola no aportaría nada.
 */
export function debeEnviarseRechazo(fila: FilaRechazable): boolean {
  if (fila.estado_gestion !== 2) return false;
  if (!(fila.motivo_rechazo || '').trim()) return false;
  return (
    fila.rechazo_envio_estado === ENVIO_PENDIENTE ||
    fila.rechazo_envio_estado === ENVIO_ERROR_REINTENTABLE
  );
}

/** Normaliza el `origen` de la fila al contrato del endpoint. */
export function normalizarOrigen(origen: string): OrigenGestion {
  return (origen || '').trim().toUpperCase() === 'PRECARGA' ? 'PRECARGA' : 'AD-HOC';
}

/**
 * Coherencia que el servidor también valida (y su BD, con un CHECK): una gestión de
 * cartera tiene fila en `pre.Precarga` y debe llevar su id; una creada en campo no
 * existe allí y debe mandar `null`. Comprobarlo ANTES de la petición evita gastar un
 * viaje de red para recibir un 400 que ya sabemos que llega.
 */
export function esPayloadCoherente(
  origen: OrigenGestion,
  idPrecarga: string | null,
): boolean {
  const tieneId = !!(idPrecarga || '').trim();
  return origen === 'PRECARGA' ? tieneId : !tieneId;
}

export interface ResultadoFallo {
  estado: typeof ENVIO_ERROR_REINTENTABLE | typeof ENVIO_DEFINITIVO;
  intentos: number;
}

/**
 * Qué hacer con un fallo de envío.
 *
 * `status` es el HTTP de la respuesta, o `null` cuando no hubo respuesta (sin cobertura,
 * DNS, timeout). El 401 cuenta como REINTENTABLE a propósito: la sesión puede renovarse
 * en el siguiente ciclo, y descartar el rechazo por un token vencido perdería el dato.
 */
export function clasificarFallo(
  status: number | null,
  intentosPrevios: number,
): ResultadoFallo {
  const intentos = intentosPrevios + 1;

  // Un 4xx (salvo 401) describe el payload: reintentarlo da exactamente el mismo
  // resultado y solo gasta datos del asesor y espacio en la bitácora.
  const definitivoPorCodigo = status !== null && status >= 400 && status < 500 && status !== 401;
  const definitivoPorIntentos = intentos >= MAX_INTENTOS_RECHAZO;

  return {
    estado:
      definitivoPorCodigo || definitivoPorIntentos
        ? ENVIO_DEFINITIVO
        : ENVIO_ERROR_REINTENTABLE,
    intentos,
  };
}

/**
 * Recorta el motivo al límite de la columna del servidor.
 *
 * `pre.Precarga.Comentario` y `appEx_Encuestas_Rechazadas.Motivo` son NVARCHAR acotados:
 * pasarse no da un error de validación amable, da un fallo de truncamiento de SQL Server
 * DENTRO de la transacción — que revertiría el encabezado recién insertado. Se recorta en
 * el dispositivo y el DTO del servidor valida el mismo tope.
 */
export const MAX_LONGITUD_MOTIVO = 500;

export function recortarMotivo(motivo: string | null): string {
  return (motivo || '').trim().slice(0, MAX_LONGITUD_MOTIVO);
}
