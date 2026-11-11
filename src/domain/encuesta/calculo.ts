import { evaluate } from 'mathjs';
import type { PreguntaEncuesta, MapaRespuestas, InstanciasMatriz } from './tipos';
import { claveRespuesta, esTipoCalculo } from './tipos';
import { resolverIdDesdeToken } from './tokens';
import { parseNumeroLocal } from './numeros';

/**
 * Motor de cálculo de los campos `tipo_dato = 'CALCULO'`.
 *
 * TRAMPAS DE mathjs QUE YA COSTARON CARO:
 *  - Los corchetes son literal de MATRIZ. El BackOffice documenta `[Q92]-[Q91]`, así
 *    que hay que normalizarlos a `Q92-Q91` antes de evaluar o el resultado es NaN.
 *  - NO pasar la fórmula a mayúsculas: los nombres de función (`round`, `sqrt`) son
 *    sensibles a mayúsculas. La sustitución de tokens sí es insensible.
 *  - Límites de palabra `\b` al sustituir, o `Q1` reemplaza dentro de `Q12`.
 */

/** Aviso no fatal producido durante el cálculo; el llamador decide si lo registra. */
export interface AvisoCalculo {
  etiqueta: string;
  mensaje: string;
}

export interface ResultadoCalculo {
  respuestas: MapaRespuestas;
  avisos: AvisoCalculo[];
}

/** Un lado de la fórmula es "operativo" si contiene un operador o una llamada a función. */
const esLadoOperativo = (s: string): boolean =>
  /[+\-*/^%]/.test(s) || /[a-zA-Z_]\w*\s*\(/.test(s);

const esHijaDeMatriz = (pregunta: PreguntaEncuesta): boolean => {
  const idPadre = pregunta.id_matriz_padre;
  return !!idPadre && String(idPadre).toLowerCase() !== 'null' && String(idPadre) !== '';
};

/**
 * Devuelve una copia del mapa de respuestas con todos los campos CALCULO resueltos.
 *
 * Itera hasta punto fijo (máx. 5 pasadas) porque un cálculo puede alimentar a otro.
 * Un CALCULO hijo de matriz se evalúa **una vez por fila**; uno de nivel raíz, una
 * sola vez. Si algún token no tiene valor numérico, el destino se vacía en lugar de
 * quedarse con un resultado obsoleto.
 */
export const aplicarCalculos = (
  base: MapaRespuestas,
  preguntas: PreguntaEncuesta[],
  matrices: InstanciasMatriz = {},
): ResultadoCalculo => {
  const respuestas: MapaRespuestas = { ...base };
  const avisos: AvisoCalculo[] = [];
  let huboCambios = true;
  let iteraciones = 0;

  const conFormula = preguntas.filter(p => esTipoCalculo(p.tipo_dato) && p.sintaxis_calculo);

  while (huboCambios && iteraciones < 5) {
    huboCambios = false;
    iteraciones++;

    conFormula.forEach(p => {
      try {
        // Normaliza los placeholders documentados ([Q92] o [92]) a tokens Qn.
        const formulaCruda = String(p.sintaxis_calculo || '').replace(/\[\s*Q?(\d+)\s*\]/gi, 'Q$1');

        // La fórmula puede venir como `Q3 = Q2 - Q1` o `Q2 - Q1 = Q3`: el destino es
        // SIEMPRE la pregunta que lleva la fórmula, y el lado con operadores es el
        // que se evalúa. El resto es documentación y se ignora.
        const partes = formulaCruda.split('=');
        let expr = partes[0];
        if (partes.length > 1) {
          expr = partes.find(esLadoOperativo)
            || partes.reduce((a, b) => ((b.match(/Q\d+/gi) || []).length > (a.match(/Q\d+/gi) || []).length ? b : a));
        }
        const exprBase = expr.trim();

        const tokens = [...new Set((exprBase.match(/\bQ\d+\b/gi) || []).map(t => t.toUpperCase()))];
        if (tokens.length === 0) return;

        const contextos: (string | null)[] = esHijaDeMatriz(p)
          ? (matrices[String(p.id_matriz_padre)] || [])
          : [null];

        contextos.forEach(uuidFila => {
          // Se acumula token -> valor y se sustituye TODO en una sola pasada con un
          // literal, en vez de construir un `new RegExp` por token. Además de quitar
          // la construcción dinámica de regex, evita recorrer la fórmula N veces.
          const valorPorToken: Record<string, string> = {};
          let puedeCalcular = true;

          tokens.forEach(token => {
            const idReal = resolverIdDesdeToken(token, p, preguntas);
            const origen = preguntas.find(x => String(x.id) === idReal);

            if (!origen) {
              puedeCalcular = false;
              avisos.push({
                etiqueta: p.etiqueta,
                mensaje: `El token ${token} no resuelve a ninguna pregunta (ni por id ni por orden).`,
              });
              return;
            }

            // Dentro de una fila manda el valor de ESA fila; si el token referencia
            // un campo de fuera de la matriz, cae a la clave global.
            const claveAcotada = uuidFila ? claveRespuesta(origen.id, uuidFila) : null;
            const valorCrudo = (claveAcotada && respuestas[claveAcotada] !== undefined)
              ? respuestas[claveAcotada]
              : (respuestas[origen.id] || '');
            const parseado = parseNumeroLocal(valorCrudo);

            if (Number.isNaN(parseado)) {
              puedeCalcular = false;
            } else {
              valorPorToken[token] = String(parseado);
            }
          });

          // Los tokens salieron de este mismo patrón sobre `exprBase`, así que toda
          // coincidencia tiene entrada en el mapa; el fallback solo cubre los casos ya
          // marcados como no calculables, donde `formulaStr` nunca llega a evaluarse.
          const formulaStr = exprBase.replace(
            /\bQ\d+\b/gi,
            (coincidencia) => valorPorToken[coincidencia.toUpperCase()] ?? coincidencia,
          );

          const claveDestino = claveRespuesta(p.id, uuidFila);

          if (puedeCalcular) {
            const resultado = evaluate(formulaStr);
            const texto = parseFloat(Number(resultado).toFixed(2)).toString();
            if (respuestas[claveDestino] !== texto) {
              respuestas[claveDestino] = texto;
              huboCambios = true;
            }
          } else if (respuestas[claveDestino] !== undefined && respuestas[claveDestino] !== '') {
            // Se vacía en vez de conservar un resultado que ya no corresponde.
            respuestas[claveDestino] = '';
            huboCambios = true;
          }
        });
      } catch (e) {
        avisos.push({
          etiqueta: p.etiqueta,
          mensaje: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  return { respuestas, avisos };
};
