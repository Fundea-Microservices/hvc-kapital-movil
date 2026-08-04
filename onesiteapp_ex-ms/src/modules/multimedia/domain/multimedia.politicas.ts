/**
 * Políticas puras de almacenamiento de multimedia.
 *
 * Este módulo no toca `fs`, ni la base de datos, ni Nest: decide **qué nombre** y
 * **qué ruta** tendrá un archivo, y **si se acepta**. Al ser puro, toda la batería de
 * seguridad (path traversal, extensiones, peso) se prueba sin servidor ni disco.
 *
 * PRINCIPIO RECTOR: EL CLIENTE NUNCA NOMBRA EL ARCHIVO.
 * El nombre final se construye **solo** con enteros que el servidor controla
 * (`IdEncuesta`, `IdCaptura`, `IdPregunta`), un hash hexadecimal de la clave de
 * instancia y una extensión de lista blanca. El nombre que envía el dispositivo se
 * conserva como *dato* en la columna `NombreOriginal`, jamás como parte de una ruta.
 * Así el path traversal deja de ser un riesgo que haya que filtrar: es imposible por
 * construcción, y las validaciones de abajo son la segunda línea de defensa.
 *
 * El separador de ruta se recibe como parámetro para que las pruebas den el mismo
 * resultado en Windows (desarrollo) y en Linux (producción).
 */

export type TipoMedio = 'FOTO' | 'MULTIMEDIA' | 'DOCUMENTO' | 'FIRMA';

export interface ContextoArchivo {
  idEncuesta: number;
  /** `BIGINT` de SQL Server: viaja como string porque puede exceder el entero seguro
   *  de JavaScript, y truncarlo colgaría el archivo de la captura equivocada. */
  idCaptura: string;
  idPregunta: number;
  /** Identifica la fila dentro de una matriz. Vacío para preguntas normales. */
  claveInstancia?: string | null;
  /** Permite varios archivos en la misma pregunta. 1 es el primero. */
  secuencia?: number;
}

export interface ResultadoValidacion {
  valido: boolean;
  motivo?: string;
}

/** Extensiones que nunca se aceptan, sea cual sea la configuración del `.env`.
 *  Son las que se ejecutan o se interpretan al abrirlas: si una de ellas llegara a
 *  servirse, un adjunto se convertiría en XSS almacenado o en código ejecutable. */
const EXTENSIONES_PROHIBIDAS: readonly string[] = [
  'svg', 'html', 'htm', 'xhtml', 'js', 'mjs', 'jsx', 'php', 'phtml', 'exe', 'dll',
  'bat', 'cmd', 'com', 'sh', 'ps1', 'jar', 'apk', 'msi', 'scr', 'vbs', 'hta', 'swf',
];

/** Nombres reservados por Windows. Un archivo llamado `CON` o `LPT1` es imposible de
 *  crear y algunas rutas heredadas lo tratan como dispositivo. */
const NOMBRES_RESERVADOS_WINDOWS: readonly string[] = [
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
];

/**
 * Normaliza una extensión: minúsculas, sin punto inicial, sin espacios. Devuelve
 * cadena vacía si no es una extensión alfanumérica plausible.
 */
export const normalizarExtension = (extension: string | null | undefined): string => {
  const limpia = String(extension ?? '').trim().toLowerCase().replace(/^\.+/, '');
  if (!/^[a-z0-9]{1,10}$/.test(limpia)) return '';
  return limpia;
};

/**
 * Comprueba la extensión contra la lista **blanca** del tipo. Se usa lista blanca y
 * no negra a propósito: una lista negra siempre va por detrás del atacante.
 * `EXTENSIONES_PROHIBIDAS` es un cinturón adicional por si alguien configura mal el
 * `.env` — la lista blanca no basta si un administrador añade `svg` sin pensarlo.
 */
export const validarTipo = (
  extension: string | null | undefined,
  permitidas: readonly string[],
): ResultadoValidacion => {
  const ext = normalizarExtension(extension);
  if (ext === '') return { valido: false, motivo: 'Extensión ausente o no válida' };
  if (EXTENSIONES_PROHIBIDAS.includes(ext)) {
    return { valido: false, motivo: `Extensión .${ext} prohibida por política` };
  }
  const blanca = permitidas.map(e => normalizarExtension(e)).filter(e => e !== '');
  if (blanca.length === 0) {
    // Sin lista configurada no se acepta nada: es preferible un rechazo visible a
    // aceptar cualquier cosa porque una variable de entorno faltaba.
    return { valido: false, motivo: 'No hay extensiones permitidas configuradas' };
  }
  if (!blanca.includes(ext)) {
    return { valido: false, motivo: `Extensión .${ext} no permitida para este tipo` };
  }
  return { valido: true };
};

/** El límite se compara contra los bytes REALES recibidos, no contra el
 *  `Content-Length` que declara el cliente. */
export const validarPeso = (bytes: number, maximoKb: number): ResultadoValidacion => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { valido: false, motivo: 'Archivo vacío' };
  }
  const maximoBytes = maximoKb * 1024;
  if (bytes > maximoBytes) {
    return { valido: false, motivo: `El archivo supera el límite de ${maximoKb} KB` };
  }
  return { valido: true };
};

/**
 * Verifica que un nombre sea seguro como componente de ruta. No se usa para construir
 * el nombre final (que se genera, no se acepta), sino como aserción defensiva antes
 * de tocar el disco: si alguna refactorización futura introdujera un nombre de origen
 * externo, esta comprobación lo detendría.
 */
export const esNombreSeguro = (nombre: string | null | undefined): boolean => {
  const valor = String(nombre ?? '');
  if (valor === '' || valor.length > 120) return false;
  // Separadores de ruta y el carácter nulo, en ambas convenciones.
  if (valor.includes('/') || valor.includes('\\')) return false;
  if (valor.includes('\0')) return false;
  // `.` y `..` como nombre completo, y cualquier recorrido embebido.
  if (valor === '.' || valor === '..') return false;
  // Solo el juego de caracteres que el generador produce.
  if (!/^[A-Za-z0-9._-]+$/.test(valor)) return false;
  // Un punto inicial oculta el archivo; dos puntos seguidos huelen a recorrido.
  if (valor.startsWith('.') || valor.includes('..')) return false;
  const base = valor.split('.')[0].toLowerCase();
  if (NOMBRES_RESERVADOS_WINDOWS.includes(base)) return false;
  return true;
};

/**
 * Reduce la clave de instancia a un sufijo hexadecimal corto y estable.
 *
 * La app envía `<uuid>_<uuid>` para las filas de matriz: contiene guiones bajos y
 * puede ser largo. Un hash determinista da un componente de nombre seguro por
 * construcción, y al ser estable el mismo archivo reintentado produce la misma ruta
 * — lo que hace la subida idempotente.
 */
export const hashClaveInstancia = (clave: string | null | undefined): string => {
  const valor = String(clave ?? '');
  if (valor === '') return '';
  // FNV-1a de 32 bits: sin dependencias, suficiente para distinguir filas de una
  // misma pregunta (la unicidad dura la garantiza el índice único de la tabla).
  let hash = 0x811c9dc5;
  for (let i = 0; i < valor.length; i += 1) {
    hash ^= valor.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * Construye el nombre final. El caso base es exactamente el que pide el requisito:
 *
 *   idEncuesta 1, idCaptura 1, idPregunta 20, extensión jpg  →  `1-1-20.jpg`
 *
 * Los sufijos solo aparecen cuando hacen falta, de modo que la convención pedida se
 * lee tal cual en la inmensa mayoría de los archivos.
 */
export const construirNombreArchivo = (
  contexto: ContextoArchivo,
  extension: string,
): string => {
  const ext = normalizarExtension(extension);
  if (ext === '') throw new Error('Extensión inválida al construir el nombre del archivo');

  const partes = [
    String(contexto.idEncuesta),
    String(contexto.idCaptura),
    String(contexto.idPregunta),
  ];

  const sufijoFila = hashClaveInstancia(contexto.claveInstancia);
  if (sufijoFila !== '') partes.push(sufijoFila);

  const secuencia = contexto.secuencia ?? 1;
  if (secuencia > 1) partes.push(`s${secuencia}`);

  return `${partes.join('-')}.${ext}`;
};

/**
 * Ruta relativa a la raíz del storage. Se particiona por encuesta para que ningún
 * directorio acumule cientos de miles de entradas — algunos sistemas de archivos se
 * degradan mucho, y un `ls` en soporte se vuelve inviable.
 *
 * En la BD se guarda **esta** ruta, no la absoluta: mover el storage a otro disco
 * pasa a ser cambiar una variable de entorno.
 */
export const construirRutaRelativa = (
  contexto: ContextoArchivo,
  extension: string,
  separador = '/',
): string =>
  [
    `encuesta-${contexto.idEncuesta}`,
    `captura-${contexto.idCaptura}`,
    construirNombreArchivo(contexto, extension),
  ].join(separador);

/**
 * Última barrera antes de leer o escribir: confirma que la ruta resuelta cae dentro
 * de la raíz del storage.
 *
 * EL DETALLE QUE SE ESCAPA SIEMPRE: no basta con `ruta.startsWith(raiz)`. Con raíz
 * `/datos`, la ruta `/datos-viejos/secreto.pdf` pasaría esa comprobación siendo un
 * directorio completamente distinto. Por eso se exige que el siguiente carácter sea
 * un separador, o que la ruta sea exactamente la raíz.
 *
 * Recibe rutas YA normalizadas por el llamador (`path.resolve`), porque resolver es
 * lo único que necesita el sistema de archivos real.
 */
export const esRutaContenida = (
  rutaAbsoluta: string,
  raizAbsoluta: string,
  separador = '/',
): boolean => {
  if (!rutaAbsoluta || !raizAbsoluta) return false;

  // Se ignora un separador final en la raíz para que `/datos` y `/datos/` sean iguales.
  const raiz = raizAbsoluta.endsWith(separador)
    ? raizAbsoluta.slice(0, -separador.length)
    : raizAbsoluta;

  // En Windows las rutas no distinguen mayúsculas; comparar tal cual daría falsos
  // negativos con `C:\Datos` frente a `c:\datos`.
  const comparar = (v: string): string => (separador === '\\' ? v.toLowerCase() : v);

  const ruta = comparar(rutaAbsoluta);
  const base = comparar(raiz);

  if (ruta === base) return true;
  return ruta.startsWith(base + separador);
};
