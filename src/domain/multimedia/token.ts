/**
 * Token que representa un archivo adjunto dentro de `local_captura.valor`.
 *
 * POR QUÉ UN TOKEN Y NO LA URI DEL ARCHIVO
 * El binario vive en `local_multimedia` (tabla propia); en `valor` solo va una
 * referencia legible. Razones:
 *  - `persistirCapturas` destruye y recrea las filas de `local_captura` en cada
 *    auto-save (~1,5 s): cualquier metadato de archivo ahí se perdería.
 *  - En iOS la ruta absoluta cambia al actualizar la app, así que persistirla
 *    invalidaría todos los archivos pendientes de subir.
 *  - El token viaja al servidor y queda en `appEx_Respuestas.Valor`, de modo que
 *    la respuesta es auditable por sí sola: dice qué archivo se esperaba, aunque
 *    la subida del binario haya fallado.
 *
 * FORMATO
 *   MEDIA::<TIPO>::<nombreVisible>::<bytes>
 *   ej. MEDIA::FOTO::recibo_luz.jpg::248310
 *
 * RESTRICCIÓN CRÍTICA: EL TOKEN NO PUEDE CONTENER COMAS.
 * `syncManager` detecta la respuesta de GPS de forma heurística: recorre las
 * respuestas y toma como coordenadas la primera cuyo valor cumpla
 * `split(',').length === 2` con ambas partes parseables como número. Un nombre de
 * archivo como "14.6, -90.5.jpg" satisfaría esa condición y el token acabaría
 * insertado como latitud/longitud de la captura. `sanearNombreVisible()` sustituye
 * las comas y `token.spec.ts` reimplementa literalmente esa heurística para
 * afirmar que ningún token la satisface.
 */

export const PREFIJO_MEDIA = 'MEDIA';

/**
 * Separador de dos caracteres. No se usa `|` porque MULTISELECT ya serializa sus
 * opciones con `||`, ni `,` por la heurística del GPS descrita arriba.
 */
export const SEPARADOR_MEDIA = '::';

/** Tope del nombre visible. El token completo queda por debajo de 120 caracteres,
 *  holgadamente dentro del VARCHAR(255) de la tabla de analítica del servidor. */
export const LONGITUD_NOMBRE_VISIBLE = 60;

export type TipoMedio = 'FOTO' | 'MULTIMEDIA' | 'DOCUMENTO' | 'FIRMA';

const TIPOS_VALIDOS: readonly TipoMedio[] = ['FOTO', 'MULTIMEDIA', 'DOCUMENTO', 'FIRMA'];

export interface TokenMedia {
  tipo: TipoMedio;
  nombreVisible: string;
  bytes: number;
}

/**
 * Filtra por código de carácter en vez de con una expresión regular: los rangos de
 * control escritos como literales son frágiles de mantener y fáciles de corromper
 * al editar el archivo. Elimina C0 (0-31), DEL (127) y C1 (128-159), y de paso
 * convierte tabulaciones y saltos de línea en espacio.
 */
const quitarCaracteresDeControl = (texto: string): string => {
  let salida = '';
  for (const caracter of texto) {
    const codigo = caracter.charCodeAt(0);
    const esControl = codigo <= 31 || codigo === 127 || (codigo >= 128 && codigo <= 159);
    if (!esControl) {
      salida += caracter;
      continue;
    }
    // El salto de línea y la tabulación se degradan a espacio para no pegar palabras.
    if (codigo === 9 || codigo === 10 || codigo === 13) salida += ' ';
    // El resto (incluido el carácter nulo, vector clásico para evadir la validación
    // de extensión) simplemente desaparece.
  }
  return salida;
};

/**
 * Deja el nombre apto para viajar dentro del token: sin comas (ver restricción
 * crítica), sin el propio separador, sin caracteres de control y recortado. Si tras
 * limpiar no queda nada, devuelve un nombre genérico para que el token conserve
 * siempre sus cuatro partes.
 */
export const sanearNombreVisible = (nombre: string | null | undefined): string => {
  const limpio = quitarCaracteresDeControl(String(nombre ?? ''))
    .split(SEPARADOR_MEDIA).join('-') // el separador dentro del nombre rompería el parseo
    .split(',').join('_')             // ← la defensa contra la heurística de GPS
    .replace(/\s+/g, ' ')
    .trim();

  if (limpio === '') return 'archivo';
  return limpio.length > LONGITUD_NOMBRE_VISIBLE
    ? limpio.slice(0, LONGITUD_NOMBRE_VISIBLE)
    : limpio;
};

export const construirTokenMedia = (token: TokenMedia): string => {
  const bytes = Number.isFinite(token.bytes) && token.bytes > 0 ? Math.trunc(token.bytes) : 0;
  return [
    PREFIJO_MEDIA,
    token.tipo,
    sanearNombreVisible(token.nombreVisible),
    String(bytes),
  ].join(SEPARADOR_MEDIA);
};

/**
 * Devuelve null si el valor no es un token de multimedia — que es el caso de
 * cualquier respuesta de texto normal, así que el llamador puede usarlo como
 * discriminador sin consultar el tipo de la pregunta.
 */
export const parsearTokenMedia = (valor: string | null | undefined): TokenMedia | null => {
  if (!valor) return null;
  const partes = String(valor).split(SEPARADOR_MEDIA);
  if (partes.length !== 4) return null;
  if (partes[0] !== PREFIJO_MEDIA) return null;

  const tipo = partes[1] as TipoMedio;
  if (!TIPOS_VALIDOS.includes(tipo)) return null;

  const bytes = Number(partes[3]);
  return {
    tipo,
    nombreVisible: partes[2],
    bytes: Number.isFinite(bytes) && bytes >= 0 ? bytes : 0,
  };
};

export const esTokenMedia = (valor: string | null | undefined): boolean =>
  parsearTokenMedia(valor) !== null;

/** Formatea un tamaño en bytes para mostrarlo junto al nombre del archivo. */
export const formatearTamanio = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
