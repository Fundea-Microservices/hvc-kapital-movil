/**
 * Resolución de las opciones de una pregunta.
 *
 * POR QUÉ ESTE MÓDULO EXISTE
 * Estas dos funciones son las que más fallos han producido en el proyecto: el
 * drill-down que terminaba guardando un municipio en la pregunta de departamento,
 * `API_1` haciendo match con `API_10`, la cascada que no filtraba por el padre. Vivían
 * dentro de la pantalla, entrelazadas con los modelos de WatermelonDB, así que no se
 * podían probar sin emulador — y por eso cada corrección se verificaba a mano.
 *
 * Aquí son puras: reciben `OpcionCatalogo[]` ya aplanado (ver `aOpcionCatalogo` en
 * `data/local/adapters/preguntaAdapter.ts`) y devuelven datos, no JSON.
 *
 * EL `null` DEL RETORNO NO ES COSMÉTICO
 * La pantalla distingue tres situaciones y las muestra distinto:
 *   - `null`  → no hay fuente resoluble; la UI avisa "Catálogo no disponible offline".
 *   - `[]`    → hay fuente, pero ninguna opción aplica (cascada con el padre elegido).
 *   - `[...]` → opciones.
 * Colapsar `null` y `[]` en un arreglo vacío cambiaría lo que ve el asesor sin que
 * ninguna prueba lo detectara.
 */

import type { MapaRespuestas, NodoOpcion, OpcionCatalogo, PreguntaEncuesta } from './tipos';
import { normalizarTipo } from './tipos';
import { resolverIdDesdeToken, sanearTokenQEnJSON } from './tokens';

/** Profundidad máxima del árbol. Un catálogo mal configurado puede ser circular. */
const PROFUNDIDAD_MAXIMA = 5;

/**
 * Normalización usada en TODAS las comparaciones de catálogo: sin acentos, sin
 * mayúsculas y sin el prefijo `cat_`, que el BackOffice usa de forma inconsistente.
 */
const normalizar = (valor: unknown): string =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace('cat_', '');

/** Origen de datos servido por una API externa vía proxy del backend. */
const esOrigenApi = (pregunta: PreguntaEncuesta): boolean =>
  normalizarTipo(pregunta.origen_datos_tipo) === 'API';

/**
 * Nombre de catálogo bajo el que se buscan las opciones de una pregunta.
 *
 * Para `origen_datos_tipo = 'API'` es el nombre sintético `API_<idPregunta>` que
 * genera `syncManager.sincronizarCatalogosApi()`. En ese caso `origen_datos_cmd` es la
 * CLAVE que el backend resuelve contra la API externa (ej. "departamentos"), **no** un
 * nombre de catálogo local: usarlo para buscar no encuentra nada.
 */
export const nombreCatalogoDe = (pregunta: PreguntaEncuesta): string => {
  if (esOrigenApi(pregunta)) return `API_${pregunta.id}`;
  return String(pregunta.opciones || pregunta.origen_datos_cmd || '');
};

/**
 * Decide si una opción pertenece al catálogo buscado.
 *
 * La comparación es EXACTA para origen API y flexible para catálogos maestros, y esa
 * asimetría es deliberada: el nombre sintético `API_<id>` lo genera la propia
 * aplicación y siempre coincide carácter a carácter, mientras que los nombres del
 * BackOffice llegan con espacios, guiones y acentos variables.
 *
 * Con `includes` en ambos lados, la pregunta de id 1 (`API_1`) también hacía match con
 * `API_10`, `API_11` y `API_100`: el select de Departamento se llenaba con municipios.
 */
const perteneceAlCatalogo = (
  opcion: OpcionCatalogo,
  catalogoBuscado: string,
  exacto: boolean,
): boolean => {
  const nombre = normalizar(opcion.nombre_catalogo);
  const codigo = normalizar(opcion.codigo_catalogo);

  if (exacto) return nombre === catalogoBuscado || codigo === catalogoBuscado;

  return (
    nombre === catalogoBuscado ||
    codigo === catalogoBuscado ||
    nombre.includes(catalogoBuscado) ||
    codigo.includes(catalogoBuscado)
  );
};

/** Lee la respuesta del padre, acotada a la fila de matriz cuando corresponde. */
const respuestaDelPadre = (
  idPadre: string,
  respuestas: MapaRespuestas,
  uuidFila?: string | null,
): string | undefined =>
  (uuidFila ? respuestas[`${idPadre}_${uuidFila}`] : undefined) ?? respuestas[idPadre];

/**
 * Resuelve qué opción del catálogo padre está seleccionada, para filtrar los hijos.
 *
 * Devuelve:
 *   - `{ requiereFiltro: false }`            → la pregunta no es hija de una cascada.
 *   - `{ requiereFiltro: true, sinRespuesta: true }` → hay cascada pero el padre está
 *     vacío; el hijo debe mostrarse sin opciones.
 *   - `{ requiereFiltro: true, idPadreOpcion }`      → filtrar por ese id.
 */
interface FiltroCascada {
  requiereFiltro: boolean;
  sinRespuesta?: boolean;
  idPadreOpcion?: string | null;
}

const resolverFiltroCascada = (
  pregunta: PreguntaEncuesta,
  catalogos: OpcionCatalogo[],
  respuestas: MapaRespuestas,
  preguntas: PreguntaEncuesta[],
  uuidFila?: string | null,
): FiltroCascada => {
  const regla = pregunta.regla_visibilidad;
  if (!regla || !regla.includes('dependeDeCatalogo')) return { requiereFiltro: false };

  try {
    const parseada = JSON.parse(sanearTokenQEnJSON(regla)) as { dependeDeCatalogo?: unknown };
    const idPadre = resolverIdDesdeToken(String(parseada.dependeDeCatalogo), pregunta, preguntas);

    const valorPadre = respuestaDelPadre(idPadre, respuestas, uuidFila);
    if (!valorPadre) return { requiereFiltro: true, sinRespuesta: true };

    const preguntaPadre = preguntas.find(p => p.id === idPadre);
    const catalogoPadre = normalizar(preguntaPadre ? nombreCatalogoDe(preguntaPadre) : '');
    const padreEsApi = !!preguntaPadre && esOrigenApi(preguntaPadre);

    // Todas las opciones cuyo texto coincide con lo que el asesor eligió. Puede haber
    // varias: dos catálogos distintos pueden tener un valor homónimo (un municipio y
    // un departamento que se llaman igual, por ejemplo).
    const candidatas = catalogos.filter(c => String(c.valor_opcion) === valorPadre);

    // De esas, las que además pertenecen al catálogo del padre. Este segundo filtro es
    // lo que evita resolver al homónimo equivocado y dejar la cascada vacía.
    const delCatalogoPadre = catalogoPadre
      ? candidatas.filter(c => perteneceAlCatalogo(c, catalogoPadre, padreEsApi))
      : [];

    const elegida = delCatalogoPadre[0] || candidatas[0];
    if (!elegida) return { requiereFiltro: true, idPadreOpcion: null };

    return {
      requiereFiltro: true,
      idPadreOpcion: String(elegida.id_remoto ?? elegida.codigo_opcion),
    };
  } catch {
    // Una regla mal formada no debe dejar la pregunta inutilizable: se ignora el
    // filtro y se muestran todas las opciones del catálogo.
    return { requiereFiltro: false };
  }
};

/**
 * Opciones planas de una pregunta.
 *
 * @returns `null` cuando no hay fuente resoluble (ver la nota del encabezado).
 */
export const obtenerOpciones = (
  pregunta: PreguntaEncuesta,
  catalogos: OpcionCatalogo[],
  respuestas: MapaRespuestas,
  preguntas: PreguntaEncuesta[],
  uuidFila?: string | null,
): string[] | null => {
  if (!pregunta) return [];

  const api = esOrigenApi(pregunta);
  const crudo = String(pregunta.opciones || pregunta.origen_datos_cmd || '').trim();

  if (!crudo && !api) return [];

  // CASO A: el BackOffice envió un arreglo JSON directo.
  if (crudo.startsWith('[')) {
    try {
      const lista = JSON.parse(crudo) as unknown;
      return Array.isArray(lista) ? lista.map(v => String(v)) : [];
    } catch {
      return [];
    }
  }

  // CASO B: lista inline separada por pipes o comas. No aplica a origen API, donde el
  // string es una clave o una URL que puede contener esos caracteres.
  if (!api && !crudo.toUpperCase().includes('CAT_')) {
    if (crudo.includes('|')) return crudo.split('|').map(o => o.trim());
    if (crudo.includes(',')) return crudo.split(',').map(o => o.trim());
  }

  // CASO C: búsqueda en el catálogo local.
  const buscado = normalizar(api ? nombreCatalogoDe(pregunta) : crudo);

  const filtro = resolverFiltroCascada(pregunta, catalogos, respuestas, preguntas, uuidFila);
  // El padre aún no se ha respondido: el hijo se muestra vacío, no con todo el catálogo.
  if (filtro.sinRespuesta) return null;

  const items = catalogos
    .filter(c => {
      if (!perteneceAlCatalogo(c, buscado, api)) return false;
      if (filtro.idPadreOpcion) return String(c.id_padre_opcion) === filtro.idPadreOpcion;
      return true;
    })
    .map(c => String(c.valor_opcion));

  // Un valor suelto sin separadores y sin catálogo que lo respalde se trata como la
  // única opción: es como el BackOffice expresa un select de un solo elemento.
  if (items.length === 0 && !api && !crudo.toUpperCase().includes('CAT_') && crudo !== '') {
    return [crudo];
  }

  return items.length > 0 ? items : null;
};

/**
 * Árbol de opciones para el SELECT con navegación padre→hijo→nieto.
 *
 * @returns `null` con el mismo criterio que `obtenerOpciones`.
 */
export const obtenerArbolOpciones = (
  pregunta: PreguntaEncuesta,
  catalogos: OpcionCatalogo[],
  respuestas: MapaRespuestas,
  preguntas: PreguntaEncuesta[],
  uuidFila?: string | null,
): NodoOpcion[] | null => {
  if (!pregunta) return [];

  const api = esOrigenApi(pregunta);
  const crudo = String(pregunta.opciones || pregunta.origen_datos_cmd || '').trim();
  const enMayusculas = crudo.toUpperCase();

  const esHijaDeCascada = !!(
    pregunta.regla_visibilidad && pregunta.regla_visibilidad.includes('dependeDeCatalogo')
  );

  const esInline =
    !api &&
    (crudo.startsWith('[') ||
      (!enMayusculas.includes('CAT_') && (crudo.includes('|') || crudo.includes(','))));

  /**
   * Cuatro casos se resuelven como árbol PLANO, reutilizando `obtenerOpciones`:
   *  - sin fuente, o lista inline: no hay jerarquía que recorrer;
   *  - hija de cascada: las opciones ya vienen filtradas a un solo padre;
   *  - **origen API**: el backend emite un único nivel por catálogo, y los "hijos"
   *    que existan en la tabla local (`id_padre_opcion`) pertenecen a OTRA pregunta
   *    — los municipios cuelgan del departamento. Sin esta guarda, el select de
   *    Departamento navegaba hacia dentro y terminaba guardando un municipio.
   */
  if (!crudo || esInline || esHijaDeCascada || api) {
    const planas = obtenerOpciones(pregunta, catalogos, respuestas, preguntas, uuidFila);
    if (planas === null) return null;
    return planas.map(valor => ({ valor, hijos: [] }));
  }

  const buscado = normalizar(crudo);
  const delCatalogo = catalogos.filter(c => perteneceAlCatalogo(c, buscado, false));
  if (delCatalogo.length === 0) return [];

  const idsDelCatalogo = new Set(delCatalogo.map(c => String(c.id_remoto)));

  const construirNodo = (
    opcion: OpcionCatalogo,
    visitados: Set<string>,
    profundidad: number,
  ): NodoOpcion => {
    const idRemoto = String(opcion.id_remoto);
    let hijos: NodoOpcion[] = [];

    // `visitados` protege contra un catálogo circular mal configurado en el
    // BackOffice (A padre de B y B padre de A), que colgaría la aplicación.
    if (profundidad < PROFUNDIDAD_MAXIMA && !visitados.has(idRemoto)) {
      visitados.add(idRemoto);
      hijos = catalogos
        .filter(c => String(c.id_padre_opcion) === idRemoto)
        .map(c => construirNodo(c, visitados, profundidad + 1));
    }

    return { valor: String(opcion.valor_opcion), hijos };
  };

  // Raíces: las opciones sin padre, o cuyo padre está fuera de este catálogo.
  const raices = delCatalogo.filter(c => {
    const idPadre = String(c.id_padre_opcion ?? '').trim();
    return idPadre === '' || idPadre.toLowerCase() === 'null' || !idsDelCatalogo.has(idPadre);
  });

  return raices.map(c => construirNodo(c, new Set<string>(), 0));
};
