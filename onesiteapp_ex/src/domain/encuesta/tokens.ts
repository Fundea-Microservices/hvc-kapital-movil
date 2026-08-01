import type { PreguntaEncuesta, MapaRespuestas } from './tipos';
import { claveRespuesta } from './tipos';

/**
 * Interpretación de la sintaxis `Qn` que el BackOffice usa tanto en
 * `sintaxis_calculo` como en `regla_visibilidad`.
 *
 * ATENCIÓN — `Qn` referencia el **id** de la pregunta, NO su `orden`. Asumir lo
 * contrario rompió en su momento todos los cálculos y todas las reglas de
 * visibilidad a la vez, y el fallo era mudo: las fórmulas simplemente daban valores
 * incorrectos. Se conserva el respaldo por `orden` solo para reglas antiguas.
 */

/**
 * Traduce una referencia de regla al id real de una pregunta.
 * Resuelve primero contra `id`; si no existe, contra `orden` (prefiriendo la misma
 * sección, que es lo que desambigua cuando dos secciones repiten el número).
 * Si la referencia no es un token `Qn`, se devuelve tal cual (ya es un id crudo).
 */
export const resolverIdDesdeToken = (
  referencia: string,
  preguntaActual: PreguntaEncuesta,
  preguntas: PreguntaEncuesta[],
): string => {
  const tokenQ = String(referencia).match(/^Q(\d+)$/i);
  if (!tokenQ) return String(referencia);
  const numero = tokenQ[1];

  let origen = preguntas.find(x => String(x.id) === numero);
  if (!origen) {
    const candidatos = preguntas.filter(x => String(x.orden) === numero);
    origen = candidatos.find(x => String(x.id_seccion) === String(preguntaActual.id_seccion)) || candidatos[0];
  }
  return origen ? String(origen.id) : String(referencia);
};

/**
 * El BackOffice a veces escribe el token `Qn` SIN comillas como valor JSON
 * (`{"dependeDeCatalogo": Q10}`), lo cual no es JSON válido y hace que `JSON.parse`
 * falle por completo, tumbando la regla entera. Se envuelve el token en comillas
 * antes de parsear; el llamador lo resuelve después con `resolverIdDesdeToken`.
 */
export const sanearTokenQEnJSON = (str: string): string =>
  str.replace(/:(\s*)Q(\d+)\b/gi, ':$1"Q$2"');

/**
 * Lee la respuesta de una pregunta. Dentro de una fila de matriz las respuestas se
 * guardan con la clave `"<id>_<uuidFila>"`, así que esa variante tiene prioridad;
 * si no existe, se cae a la clave global — lo que permite que una fórmula dentro de
 * una matriz referencie un campo de fuera.
 */
export const resolverRespuesta = (
  idPregunta: string,
  respuestas: MapaRespuestas,
  uuidFila?: string | null,
): string => {
  if (uuidFila) {
    const acotada = respuestas[claveRespuesta(idPregunta, uuidFila)];
    if (acotada !== undefined) return acotada;
  }
  return respuestas[idPregunta] ?? '';
};
