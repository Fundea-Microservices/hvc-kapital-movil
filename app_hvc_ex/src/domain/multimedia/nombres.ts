/**
 * Resolución de extensión y nombre de archivo local.
 *
 * POR QUÉ ESTO ES DOMINIO Y NO UN DETALLE DE LA PANTALLA
 * La extensión decide tres cosas independientes: cómo se llama el archivo en el
 * almacenamiento durable del dispositivo, si el backend lo aceptará (lista blanca) y
 * qué icono ve el asesor. Aislarla permite probar aquí los casos hostiles —MIME que
 * miente, doble extensión, nombre sin punto— sin emulador.
 *
 * REGLA DE CONFIANZA
 * El nombre que da el sistema operativo es el más fiable para la extensión, porque es
 * el que el usuario ve. El MIME solo se usa cuando el nombre no aporta una extensión
 * reconocible: `getDocumentAsync` sobre Drive u OneDrive devuelve a veces
 * `application/octet-stream`, y la cámara devuelve URIs sin nombre.
 *
 * Ninguna decisión de seguridad se toma aquí: el servidor revalida contra su propia
 * lista blanca. Este módulo solo evita subidas que se sabe que van a fallar.
 */

import type { TipoMedio } from './token';

/** Extensión de reserva por familia, cuando ni el nombre ni el MIME dicen nada. */
const EXTENSION_POR_DEFECTO: Readonly<Record<TipoMedio, string>> = {
  FOTO: 'jpg',
  MULTIMEDIA: 'jpg',
  DOCUMENTO: 'pdf',
  FIRMA: 'png',
};

/**
 * MIME → extensión. Deliberadamente corto: solo lo que el BackOffice permite hoy.
 * Añadir una entrada aquí NO habilita el tipo — la lista blanca efectiva vive en el
 * `.env` del backend, que es quien decide.
 */
const EXTENSION_POR_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

/** Tope defensivo: una "extensión" larguísima es basura, no una extensión. */
const LONGITUD_MAXIMA_EXTENSION = 10;

/**
 * Extrae la extensión de un nombre o de una URI. Devuelve cadena vacía si no hay una
 * extensión plausible, en vez de inventar una.
 */
export const extensionDesdeNombre = (nombre: string | null | undefined): string => {
  // Se descartan la query y el fragmento: las URIs `content://` de Android suelen
  // traerlos, y `?token=abc` no es una extensión.
  const limpio = String(nombre ?? '').split('?')[0].split('#')[0];
  const ultimoSegmento = limpio.split('/').pop() ?? '';
  const punto = ultimoSegmento.lastIndexOf('.');

  // Sin punto, o punto al principio (`.gitignore` no tiene extensión), o al final.
  if (punto <= 0 || punto === ultimoSegmento.length - 1) return '';

  const candidata = ultimoSegmento.slice(punto + 1).toLowerCase();

  // Solo letras y dígitos. Esto descarta de raíz `jpg\0.exe`, `jpg/../..` y demás
  // intentos de colar separadores o el carácter nulo dentro de la extensión.
  if (!/^[a-z0-9]+$/.test(candidata)) return '';
  if (candidata.length > LONGITUD_MAXIMA_EXTENSION) return '';

  return candidata;
};

export const extensionDesdeMime = (mime: string | null | undefined): string => {
  // El `Content-Type` puede venir con parámetros: `text/plain; charset=utf-8`.
  const base = String(mime ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSION_POR_MIME[base] ?? '';
};

/**
 * Resuelve la extensión definitiva del archivo, con el orden de confianza descrito
 * arriba y un valor de reserva por familia para que el nombre nunca quede sin sufijo.
 */
export const resolverExtension = (
  nombre: string | null | undefined,
  mime: string | null | undefined,
  tipo: TipoMedio,
): string =>
  extensionDesdeNombre(nombre) || extensionDesdeMime(mime) || EXTENSION_POR_DEFECTO[tipo];

/**
 * Nombre del archivo DENTRO del dispositivo. No es el nombre final del servidor: ese
 * lo construye el backend con el `IdCaptura` real, que aún no existe en el momento de
 * la captura (es un IDENTITY que genera SQL Server en el `/submit`).
 *
 * `epochMs` en el nombre es intencional y resuelve dos problemas a la vez:
 *  - `<Image>` de React Native cachea el bitmap POR URI, así que reescribir la misma
 *    ruta le mostraría al asesor la miniatura anterior tras retomar una foto.
 *  - El reemplazo se vuelve atómico: se escribe el archivo nuevo y luego se borra el
 *    viejo, sin ventana en la que la ruta apunte a un archivo a medio copiar.
 */
export const construirNombreLocal = (
  idPregunta: string,
  uuidFila: string | null | undefined,
  extension: string,
  epochMs: number,
): string => {
  // Un fragmento del uuid basta para distinguir filas de una misma matriz y mantiene
  // el nombre corto; la unicidad real la garantiza el epoch.
  const fila = uuidFila ? String(uuidFila).replace(/-/g, '').slice(0, 8) : '0';
  return `${idPregunta}-${fila}-${epochMs}.${extension}`;
};

/** Carpeta por instancia: purgar una encuesta entera es borrar un directorio. */
export const carpetaDeInstancia = (uuidBase: string): string => `multimedia/${uuidBase}`;

/** Ruta relativa a persistir. NUNCA se guarda la absoluta: en iOS el contenedor
 *  lleva un UUID que cambia al actualizar la app, y toda la cola pendiente quedaría
 *  apuntando a rutas inexistentes. */
export const construirRutaRelativaLocal = (uuidBase: string, nombreLocal: string): string =>
  `${carpetaDeInstancia(uuidBase)}/${nombreLocal}`;
