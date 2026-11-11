import type { PreguntaEncuesta, MapaRespuestas } from './tipos';
import { claveRespuesta } from './tipos';
import { resolverIdDesdeToken, sanearTokenQEnJSON } from './tokens';

/**
 * Cascada entre catálogos: qué preguntas dependen de cuál, y qué hay que limpiar
 * cuando el padre cambia de valor.
 *
 * EL PROBLEMA QUE RESUELVE
 * La regla `{"dependeDeCatalogo": <idPadre>}` solo exige que el padre tenga *alguna*
 * respuesta para que el hijo sea visible. Por tanto, al cambiar de Departamento el
 * Municipio NO se oculta y `purgarOcultos` no lo toca: conserva un municipio que
 * pertenece al departamento anterior. Es peor que un campo vacío, porque el dato
 * parece válido y se envía al servidor.
 */

/** Lee el id del padre declarado en `regla_visibilidad`, o null si la pregunta no es hija de cascada. */
export const idPadreDeCascada = (
  pregunta: PreguntaEncuesta,
  preguntas: PreguntaEncuesta[],
): string | null => {
  const regla = pregunta.regla_visibilidad;
  if (!regla || !regla.includes('dependeDeCatalogo')) return null;
  try {
    const parseada = JSON.parse(sanearTokenQEnJSON(regla));
    if (parseada?.dependeDeCatalogo === undefined || parseada?.dependeDeCatalogo === null) return null;
    // El BackOffice puede escribir el id crudo o el token Qn.
    return resolverIdDesdeToken(String(parseada.dependeDeCatalogo), pregunta, preguntas);
  } catch {
    return null;
  }
};

/** Hijas directas de una pregunta en la cascada de catálogos. */
export const hijasDeCascada = (
  idPadre: string,
  preguntas: PreguntaEncuesta[],
): PreguntaEncuesta[] =>
  preguntas.filter(p => idPadreDeCascada(p, preguntas) === String(idPadre));

/**
 * Todas las descendientes, no solo las hijas directas: en una cadena
 * Departamento → Municipio → Aldea, cambiar el departamento debe limpiar ambas.
 * El conjunto `visitados` corta los ciclos que produciría una configuración errónea
 * del BackOffice (A depende de B y B de A), que si no colgaría la app.
 */
export const descendientesDeCascada = (
  idPadre: string,
  preguntas: PreguntaEncuesta[],
): PreguntaEncuesta[] => {
  const encontradas: PreguntaEncuesta[] = [];
  const visitados = new Set<string>([String(idPadre)]);
  const pendientes = [String(idPadre)];

  while (pendientes.length > 0) {
    const actual = pendientes.shift() as string;
    hijasDeCascada(actual, preguntas).forEach(hija => {
      if (visitados.has(hija.id)) return;
      visitados.add(hija.id);
      encontradas.push(hija);
      pendientes.push(hija.id);
    });
  }
  return encontradas;
};

export interface ResultadoLimpieza {
  respuestas: MapaRespuestas;
  /** Claves de estado eliminadas, para purgarlas también de la persistencia. */
  clavesLimpiadas: string[];
}

/**
 * Limpia las respuestas de todas las descendientes de una pregunta cuyo valor acaba
 * de cambiar. Dentro de una matriz solo se limpia la fila indicada, no las demás.
 *
 * Se limpia **solo si el valor realmente cambió**: volver a tocar el select y elegir
 * la misma opción no debe borrar el trabajo ya hecho.
 */
export const limpiarDescendientesDeCascada = (
  idPregunta: string,
  valorAnterior: string | undefined,
  valorNuevo: string,
  respuestas: MapaRespuestas,
  preguntas: PreguntaEncuesta[],
  uuidFila?: string | null,
): ResultadoLimpieza => {
  if ((valorAnterior ?? '') === valorNuevo) {
    return { respuestas, clavesLimpiadas: [] };
  }

  const descendientes = descendientesDeCascada(idPregunta, preguntas);
  if (descendientes.length === 0) {
    return { respuestas, clavesLimpiadas: [] };
  }

  const limpias = { ...respuestas };
  const clavesLimpiadas: string[] = [];

  descendientes.forEach(hija => {
    const clave = claveRespuesta(hija.id, uuidFila);
    if (limpias[clave] !== undefined && limpias[clave] !== '') {
      delete limpias[clave];
      clavesLimpiadas.push(clave);
    }
  });

  return { respuestas: limpias, clavesLimpiadas };
};
