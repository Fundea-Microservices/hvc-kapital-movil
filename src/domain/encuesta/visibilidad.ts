import type { PreguntaEncuesta, MapaRespuestas } from './tipos';
import { normalizarComparacion } from './tipos';
import { resolverIdDesdeToken, sanearTokenQEnJSON, resolverRespuesta } from './tokens';

/**
 * Motor de reglas de visibilidad (`regla_visibilidad` del BackOffice).
 *
 * Formatos admitidos, en orden de evaluación:
 *   1. JSON `{"dependeDeCatalogo": <ref>}`  — cascada de catálogos: visible en cuanto
 *      la pregunta padre tenga cualquier respuesta.
 *   2. JSON `{"dependeDe": <ref>, "valorEsperado": v}` — igualdad simple.
 *   3. Expresión `Q53=="SI"` o `53=="SI"` — comparación directa.
 *   4. Expresión compuesta con tokens `Qn` — se sustituyen y se evalúa.
 *
 * REGLA DE ORO: ante una regla malformada se devuelve **visible**. Ocultar sería
 * indistinguible de "sin regla" y el dato se perdería en campo sin que nadie lo note.
 */

/** Neutraliza los metacaracteres de una cadena para usarla como literal dentro de un
 *  patrón. Sin esto, cualquier clave de respuesta que llevara `.`, `(` o `*` dejaría
 *  de ser un nombre y pasaría a ser un patrón con significado propio. */
const escaparParaRegex = (valor: string): string =>
  valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Resultado de evaluar una regla, con el motivo cuando no se pudo interpretar. */
export interface ResultadoVisibilidad {
  visible: boolean;
  /** Presente solo si la regla era inválida; el llamador decide si lo registra. */
  errorRegla?: string;
}

export const evaluarVisibilidad = (
  pregunta: PreguntaEncuesta,
  preguntas: PreguntaEncuesta[],
  respuestas: MapaRespuestas,
  uuidFila?: string | null,
): ResultadoVisibilidad => {
  if (!pregunta.regla_visibilidad) return { visible: true };

  const leer = (idPreg: string) => resolverRespuesta(idPreg, respuestas, uuidFila);

  try {
    const reglaStr = String(pregunta.regla_visibilidad).trim();

    if (reglaStr.startsWith('{')) {
      const regla = JSON.parse(sanearTokenQEnJSON(reglaStr));

      // Cascada: visible en cuanto el padre tenga una respuesta seleccionada.
      if (regla.dependeDeCatalogo) {
        const idPadre = resolverIdDesdeToken(String(regla.dependeDeCatalogo), pregunta, preguntas);
        const respuestaPadre = leer(idPadre);
        return { visible: !!respuestaPadre && respuestaPadre.trim() !== '' };
      }

      const idDependencia = resolverIdDesdeToken(String(regla.dependeDe), pregunta, preguntas);
      return {
        visible: normalizarComparacion(leer(idDependencia)) === normalizarComparacion(regla.valorEsperado),
      };
    }

    // Comparación simple: admite id crudo (`53=="SI"`) y token (`Q53=="SI"`).
    const comparacion = reglaStr.match(/(\w+)\s*(==|===|=)\s*['"]([^'"]+)['"]/);
    if (comparacion) {
      const [, referencia, , valorEsperado] = comparacion;
      const idReal = resolverIdDesdeToken(referencia, pregunta, preguntas);
      return { visible: normalizarComparacion(leer(idReal)) === normalizarComparacion(valorEsperado) };
    }

    // Regla compuesta: se sustituyen primero los tokens Qn y luego las claves crudas.
    let reglaEvaluada = reglaStr.replace(/\bQ(\d+)\b/gi, (_m, num) => {
      const valorToken = leer(resolverIdDesdeToken(`Q${num}`, pregunta, preguntas));
      return `'${String(valorToken).replace(/'/g, "\\'")}'`;
    });

    // Dentro de una matriz, las claves acotadas se exponen también sin sufijo para
    // que una regla escrita con el id "pelado" siga funcionando fila a fila.
    const fuente: MapaRespuestas = { ...respuestas };
    if (uuidFila) {
      const sufijo = `_${uuidFila}`;
      Object.keys(respuestas).forEach(k => {
        if (k.endsWith(sufijo)) fuente[k.slice(0, -sufijo.length)] = respuestas[k];
      });
    }
    Object.keys(fuente).forEach(clave => {
      const valor = fuente[clave] ? `'${fuente[clave]}'` : "''";
      // La clave se escapa antes de entrar en el patrón. Hoy son ids numéricos y
      // uuids —donde escapar no cambia nada—, pero la clave nace de los datos y no
      // del código: sin escapar, un metacarácter la convertiría en un patrón activo
      // capaz de sustituir donde no debe o de degenerar en ReDoS.
      const claveEscapada = escaparParaRegex(clave);
      // Límites de palabra para no corromper números ya sustituidos.
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      reglaEvaluada = reglaEvaluada.replace(new RegExp(`\\b${claveEscapada}\\b`, 'g'), valor);
    });

    return { visible: !!Function(`"use strict"; return (${reglaEvaluada})`)() };
  } catch (e) {
    return {
      visible: true,
      errorRegla: e instanceof Error ? e.message : String(e),
    };
  }
};

/** Atajo booleano para los llamadores que no necesitan el motivo del error. */
export const esVisible = (
  pregunta: PreguntaEncuesta,
  preguntas: PreguntaEncuesta[],
  respuestas: MapaRespuestas,
  uuidFila?: string | null,
): boolean => evaluarVisibilidad(pregunta, preguntas, respuestas, uuidFila).visible;
