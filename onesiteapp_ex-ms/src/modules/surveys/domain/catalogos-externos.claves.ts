/**
 * Lógica pura para resolver la CLAVE que el BackOffice escribe en `OrigenDatosCmd`
 * (ej. "departamentos", "Municipio") a la variable de entorno que contiene la URL
 * real de la API externa (`API_CATALOGOS_EXT_<CLAVE>_URL`). Sin dependencias de
 * Nest ni de I/O: testeable con Node plano.
 *
 * Antes, `OrigenDatosCmd` era la URL completa — expuesta en una tabla de datos y
 * acotada por el VARCHAR(255) de la columna. Ahora es una clave corta y la URL
 * vive solo en el `.env` del servidor.
 */

/** Placeholder que el BackOffice usa en la URL para catálogos dependientes (ej. municipios por departamento). */
export const PLACEHOLDER_PADRE = '{padre}';

const PREFIJO_VARIABLE_URL = 'API_CATALOGOS_EXT_';
const SUFIJO_VARIABLE_URL = '_URL';

/**
 * trim → sin acentos (NFD) → MAYÚSCULAS → todo lo no alfanumérico se vuelve `_` →
 * sin `_` en los bordes. Determinista: la misma clave siempre normaliza igual,
 * sin importar mayúsculas/espacios/acentos que use el BackOffice.
 */
export function normalizarClaveCatalogo(
  clave: string | null | undefined,
): string {
  if (!clave) return '';
  return clave
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Variantes singular/plural de una clave YA normalizada, en orden de preferencia
 * (la primera es siempre la clave tal cual — el match exacto gana). Sin
 * diccionario de irregulares: reglas simples de pluralización/singularización
 * en español. Puede generar alguna variante sin sentido (ej. "PAIS" -> "PAI"),
 * pero es inofensivo porque solo se usa para buscar variables de entorno que,
 * si no existen, simplemente no se encuentran.
 */
export function variantesClave(claveNormalizada: string): string[] {
  if (!claveNormalizada) return [];

  const variantes = [claveNormalizada];

  const terminaEnVocal = /[AEIOU]$/.test(claveNormalizada);
  const terminaEnS = /S$/.test(claveNormalizada);
  const terminaEnEs = /ES$/.test(claveNormalizada);

  if (terminaEnEs) {
    variantes.push(claveNormalizada.slice(0, -2)); // REGIONES -> REGION (quita el sufijo consonante+ES)
  }
  if (terminaEnS && !terminaEnEs) {
    variantes.push(claveNormalizada.slice(0, -1)); // MUNICIPIOS -> MUNICIPIO (quita solo la S)
  }
  if (!terminaEnS) {
    // Singular -> plural: vocal final + S, consonante final + ES.
    variantes.push(
      terminaEnVocal ? `${claveNormalizada}S` : `${claveNormalizada}ES`,
    );
  }

  // De-duplicar preservando el orden (el exacto siempre primero).
  return [...new Set(variantes)];
}

/** Nombres de variable de entorno a probar, en el mismo orden que `variantesClave`. */
export function nombresVariableUrl(clave: string): string[] {
  const normalizada = normalizarClaveCatalogo(clave);
  if (!normalizada) return [];
  return variantesClave(normalizada).map(
    (v) => `${PREFIJO_VARIABLE_URL}${v}${SUFIJO_VARIABLE_URL}`,
  );
}

export function esUrlAbsoluta(valor: string): boolean {
  return /^https?:\/\//i.test(valor);
}

export function esRutaRelativa(valor: string): boolean {
  return valor.startsWith('/');
}

export function esDependienteUrl(url: string): boolean {
  return url.includes(PLACEHOLDER_PADRE);
}

/** Reemplaza TODAS las ocurrencias de {padre} por el código, codificado para URL. */
export function sustituirCodigoPadre(url: string, codigoPadre: string): string {
  return url.split(PLACEHOLDER_PADRE).join(encodeURIComponent(codigoPadre));
}
