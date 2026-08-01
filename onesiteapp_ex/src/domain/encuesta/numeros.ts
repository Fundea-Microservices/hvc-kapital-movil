/**
 * Conversión de valores capturados a número.
 *
 * Los valores se guardan SIEMPRE como string en toda la cadena (estado, SQLite y
 * payload de envío), así que cualquier aritmética pasa por aquí primero.
 */

/**
 * Convierte un valor capturado a número tolerando las dos convenciones de
 * separadores que conviven en Guatemala, y el hecho de que el teclado en español
 * produce coma decimal:
 *
 *   "1.234,56" -> 1234.56   (coma decimal, punto de millar)
 *   "1,234.56" -> 1234.56   (punto decimal, coma de millar)
 *   "12,5"     -> 12.5
 *
 * El criterio es que **el separador que aparece más a la derecha es el decimal**.
 * `parseFloat("12,5")` devolvería 12, perdiendo el decimal en silencio — el peor
 * modo de fallo posible en un dato numérico.
 *
 * Devuelve NaN si no hay número; el llamador decide qué significa eso.
 */
export const parseNumeroLocal = (valorCrudo: string): number => {
  let limpio = String(valorCrudo || '').trim().replace(/[^0-9.,-]/g, '');
  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');

  if (ultimaComa > ultimoPunto) {
    // La coma es el separador decimal; cualquier punto previo es de miles.
    limpio = limpio.replace(/\./g, '').replace(',', '.');
  } else {
    // El punto es el separador decimal (o no hay separadores); las comas son de miles.
    limpio = limpio.replace(/,/g, '');
  }
  return parseFloat(limpio);
};
