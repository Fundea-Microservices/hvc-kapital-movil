/**
 * Saneamiento de la entrada en campos numéricos — funciones puras, sin React ni
 * WatermelonDB, testeables con Node plano (mismo patrón que `reglaValidacion.ts`).
 *
 * Por qué existe: `keyboardType` de React Native es solo una SUGERENCIA de teclado.
 * En Android no impide pegar desde el portapapeles ni usar teclados de terceros, así
 * que un campo numérico seguía aceptando letras. El filtrado real tiene que hacerse
 * sobre el texto, no delegarse al teclado.
 */

export interface OpcionesNumericas {
  permiteDecimales: boolean;
  permiteNegativos: boolean;
}

/**
 * El BackOffice mezcla nomenclatura en inglés y español para el mismo concepto
 * (`NUMBER` y `NUMERO`), y esa fue exactamente la causa del fallo: solo se
 * reconocían los nombres en español, así que un campo `NUMBER` caía al input de
 * texto libre. Se aceptan todas las variantes conocidas.
 */
const TIPOS_DECIMALES = ['NUMBER', 'NUMERO', 'NUMERIC', 'DECIMAL', 'MONEDA', 'MONTO', 'FLOAT'];
const TIPOS_ENTEROS = ['ENTERO', 'INT', 'INTEGER'];

const normalizar = (tipo: string | null | undefined): string =>
  (tipo || '').trim().toUpperCase();

export function esTipoNumerico(tipo: string | null | undefined): boolean {
  const t = normalizar(tipo);
  return TIPOS_DECIMALES.includes(t) || TIPOS_ENTEROS.includes(t);
}

/** Los enteros no admiten separador decimal; el resto de tipos numéricos sí. */
export function opcionesPorTipo(tipo: string | null | undefined): OpcionesNumericas {
  const t = normalizar(tipo);
  return {
    permiteDecimales: !TIPOS_ENTEROS.includes(t),
    permiteNegativos: true,
  };
}

/**
 * Deja únicamente dígitos, como máximo UN separador decimal y un signo negativo
 * inicial. Se aceptan tanto `.` como `,` porque el teclado en español produce coma;
 * el separador se conserva tal cual lo tecleó el encuestador — `parseNumeroLocal`
 * (motor de cálculo) ya tolera ambos, así que no hace falta normalizarlo aquí y se
 * evita que el cursor salte mientras se escribe.
 */
export function sanitizarEntradaNumerica(texto: string, opciones: OpcionesNumericas): string {
  const entrada = String(texto ?? '');
  if (entrada === '') return '';

  const negativo = opciones.permiteNegativos && entrada.trimStart().startsWith('-');

  let resultado = '';
  let separadorUsado = false;

  for (const caracter of entrada) {
    if (caracter >= '0' && caracter <= '9') {
      resultado += caracter;
      continue;
    }
    // Solo el primer separador sobrevive: "1,2,3" -> "1,23"
    if (opciones.permiteDecimales && (caracter === '.' || caracter === ',') && !separadorUsado) {
      separadorUsado = true;
      resultado += caracter;
    }
  }

  return negativo ? `-${resultado}` : resultado;
}
