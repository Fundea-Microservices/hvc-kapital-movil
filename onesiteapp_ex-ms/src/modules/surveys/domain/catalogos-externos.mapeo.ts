/**
 * Lógica pura para interpretar la respuesta de la API externa de catálogos.
 * Todo lo que depende de "qué forma tiene el JSON" vive aquí, parametrizado por
 * `MapeoRespuestaExterna` — cambiar de proveedor de API es cambiar este mapeo
 * (normalmente por `.env`, ver `mapeoDesdeEntorno`), sin tocar el servicio que
 * hace las llamadas HTTP ni el que orquesta raíz/dependientes.
 *
 * Formato real observado (Guatemala, catálogo de lugares):
 *   { data: { catalogos: [ { valorCore, nombre, activo, orden, hijos: [...] } ] } }
 * Los `hijos` son las opciones reales (ej. los departamentos); el nodo raíz
 * (ej. el país) es un envoltorio, no una opción seleccionable.
 */

export interface MapeoRespuestaExterna {
  /** Ruta (dot-path) hacia el arreglo de nodos raíz dentro del cuerpo de la respuesta. */
  rutaDatos: string[];
  /** Nombres de campo que pueden contener el arreglo de hijos de un nodo. */
  clavesHijos: string[];
  /** Nombres de campo candidatos para el código de la opción, en orden de preferencia. */
  camposCodigo: string[];
  /** Nombres de campo candidatos para la etiqueta visible, en orden de preferencia. */
  camposEtiqueta: string[];
  /** Campo que indica si la opción está activa; null = no filtrar por actividad. */
  campoActivo: string | null;
  /** Campo con el orden explícito de la opción; null = no hay orden explícito. */
  campoOrden: string | null;
  /** Si true, desempata por etiqueta (alfabético, es-ES) cuando el orden es igual. */
  ordenarAlfabetico: boolean;
}

export interface OpcionExterna {
  codigo: string;
  etiqueta: string;
  orden: number;
}

/**
 * Mapeo por defecto: el formato real de la API de catálogos de lugares.
 * `valorCore` va PRIMERO entre los campos de código a propósito — es el
 * identificador de negocio (el que se usa para enlazar padre-hijo), no el
 * `catalogoId` (un UUID interno). Si algún día la API agrega un campo `id` o
 * `codigo`, este orden evita que la cascada padre-hijo se rompa en silencio.
 */
export const MAPEO_POR_DEFECTO: MapeoRespuestaExterna = {
  rutaDatos: ['data', 'catalogos'],
  clavesHijos: ['hijos', 'children'],
  camposCodigo: ['valorCore', 'codigo', 'id', 'value', 'clave', 'codigoOpcion'],
  camposEtiqueta: [
    'nombre',
    'descripcion',
    'valor',
    'label',
    'text',
    'nombreCorto',
  ],
  campoActivo: 'activo',
  campoOrden: 'orden',
  ordenarAlfabetico: true,
};

/** Lista de alternativas separadas por coma (ej. nombres de campo a probar en orden). */
const dividirLista = (valor: string | undefined): string[] | null =>
  dividirPor(valor, ',');

/**
 * Ruta jerárquica separada por PUNTO (ej. `data.catalogos` -> ['data','catalogos']).
 *
 * Estaba usando `dividirLista`, que parte por coma: `data.catalogos` producía
 * `['data.catalogos']` y `leerRuta` buscaba una clave llamada literalmente
 * "data.catalogos", que no existe. El fallo era INVISIBLE porque `extraerFilas` tiene
 * un respaldo tolerante que prueba `data.{catalogos,resultado,items}` a mano: la API
 * real funcionaba y la variable de entorno no hacía absolutamente nada.
 */
const dividirRuta = (valor: string | undefined): string[] | null =>
  dividirPor(valor, '.');

const dividirPor = (
  valor: string | undefined,
  separador: string,
): string[] | null => {
  if (valor === undefined) return null;
  const partes = valor
    .split(separador)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return partes.length > 0 ? partes : null;
};

/**
 * Construye el mapeo a partir de una función `leer` que resuelve variables de
 * entorno (normalmente `ConfigService.get.bind(configService)`). Desacoplado de
 * Nest para que sea testeable con Node plano. Cualquier variable ausente cae al
 * valor por defecto correspondiente — nunca falla por configuración incompleta.
 */
export function mapeoDesdeEntorno(
  leer: (clave: string) => string | undefined,
): MapeoRespuestaExterna {
  const rutaDatos = dividirRuta(leer('API_CATALOGOS_EXT_RUTA_DATOS'));
  const clavesHijos = dividirLista(leer('API_CATALOGOS_EXT_CLAVES_HIJOS'));
  const camposCodigo = dividirLista(leer('API_CATALOGOS_EXT_CAMPOS_CODIGO'));
  const camposEtiqueta = dividirLista(
    leer('API_CATALOGOS_EXT_CAMPOS_ETIQUETA'),
  );
  const campoActivoRaw = leer('API_CATALOGOS_EXT_CAMPO_ACTIVO');
  const campoOrdenRaw = leer('API_CATALOGOS_EXT_CAMPO_ORDEN');
  const ordenarAlfabeticoRaw = leer('API_CATALOGOS_EXT_ORDENAR_ALFABETICO');

  return {
    rutaDatos: rutaDatos ?? MAPEO_POR_DEFECTO.rutaDatos,
    clavesHijos: clavesHijos ?? MAPEO_POR_DEFECTO.clavesHijos,
    camposCodigo: camposCodigo ?? MAPEO_POR_DEFECTO.camposCodigo,
    camposEtiqueta: camposEtiqueta ?? MAPEO_POR_DEFECTO.camposEtiqueta,
    campoActivo:
      campoActivoRaw !== undefined
        ? campoActivoRaw || null
        : MAPEO_POR_DEFECTO.campoActivo,
    campoOrden:
      campoOrdenRaw !== undefined
        ? campoOrdenRaw || null
        : MAPEO_POR_DEFECTO.campoOrden,
    ordenarAlfabetico:
      ordenarAlfabeticoRaw !== undefined
        ? ordenarAlfabeticoRaw.trim().toLowerCase() !== 'false'
        : MAPEO_POR_DEFECTO.ordenarAlfabetico,
  };
}

/** Camina un dot-path dentro de un objeto; undefined si cualquier tramo no existe. */
function leerRuta(obj: unknown, ruta: string[]): unknown {
  let actual: unknown = obj;
  for (const tramo of ruta) {
    if (!actual || typeof actual !== 'object') return undefined;
    actual = (actual as Record<string, unknown>)[tramo];
  }
  return actual;
}

/** Primer valor de `objeto[clave]` (para cualquiera de las `claves`) que sea un arreglo. */
function primerArreglo(
  objeto: Record<string, unknown>,
  claves: string[],
): unknown[] | null {
  for (const clave of claves) {
    const valor = objeto[clave];
    if (Array.isArray(valor)) return valor;
  }
  return null;
}

/**
 * Desenvuelve la respuesta cruda a un arreglo de filas (las OPCIONES reales,
 * no los nodos raíz). Tolera: (1) un arreglo plano en la raíz; (2) envolturas
 * comunes (`data`/`resultado`/`items`) si `rutaDatos` no aplica; (3) el caso
 * real: `rutaDatos` apunta a un arreglo de nodos RAÍZ (ej. el país) cuyas
 * opciones reales están en su propio arreglo de hijos (ej. los departamentos).
 * Solo se toma UN nivel de hijos — un nivel más profundo (ej. municipios
 * anidados dentro de cada departamento) se ignora aquí a propósito: esa
 * relación la resuelve la fase de catálogos dependientes con la pregunta hija
 * correspondiente, para no mezclar dos catálogos bajo el mismo nombre
 * sintético "API_<IdPregunta>".
 */
export function extraerFilas(
  cuerpo: unknown,
  mapeo: MapeoRespuestaExterna,
): unknown[] {
  if (Array.isArray(cuerpo)) return cuerpo;
  if (!cuerpo || typeof cuerpo !== 'object') return [];

  const raizPorRuta = leerRuta(cuerpo, mapeo.rutaDatos);
  if (Array.isArray(raizPorRuta)) {
    return desenvolverHijos(raizPorRuta, mapeo.clavesHijos);
  }

  // Fallbacks tolerantes si `rutaDatos` no aplica a esta respuesta en particular.
  const obj = cuerpo as Record<string, unknown>;
  const directo = primerArreglo(obj, ['data', 'resultado', 'items']);
  if (directo) return directo;

  if (obj.data && typeof obj.data === 'object') {
    const anidado = primerArreglo(obj.data as Record<string, unknown>, [
      'catalogos',
      'resultado',
      'items',
    ]);
    if (anidado) return desenvolverHijos(anidado, mapeo.clavesHijos);
  }

  return [];
}

/** Si los nodos son raíces envolventes con hijos, devuelve ESE nivel; si no, los nodos tal cual. */
function desenvolverHijos(nodos: unknown[], clavesHijos: string[]): unknown[] {
  if (nodos.length === 0) return nodos;
  const primero = nodos[0];
  if (typeof primero !== 'object' || primero === null) return nodos;

  const tieneHijos = clavesHijos.some((clave) =>
    Array.isArray((primero as Record<string, unknown>)[clave]),
  );
  if (!tieneHijos) return nodos;

  // Une los hijos de TODOS los nodos raíz (normalmente hay uno solo, ej. el país).
  return nodos.flatMap((n) => {
    if (typeof n !== 'object' || n === null) return [];
    const hijos = primerArreglo(n as Record<string, unknown>, clavesHijos);
    return hijos ?? [];
  });
}

/** true si el campo de actividad indica explícitamente inactivo; ausente = activo. */
function esInactivo(
  fila: Record<string, unknown>,
  campoActivo: string | null,
): boolean {
  if (!campoActivo) return false;
  if (!(campoActivo in fila)) return false; // sin el campo, se asume activo
  const valor = fila[campoActivo];
  return (
    valor === false ||
    valor === 0 ||
    valor === 'false' ||
    valor === '0' ||
    valor === 'no'
  );
}

/** Normaliza una fila cruda a { codigo, etiqueta, orden }, o null si falta código/etiqueta. */
export function normalizarFilaExterna(
  fila: unknown,
  mapeo: MapeoRespuestaExterna,
): OpcionExterna | null {
  if (typeof fila !== 'object' || fila === null) return null;
  const f = fila as Record<string, unknown>;

  if (esInactivo(f, mapeo.campoActivo)) return null;

  const codigo = mapeo.camposCodigo
    .map((c) => f[c])
    .find((v) => v !== undefined && v !== null);
  const etiqueta = mapeo.camposEtiqueta
    .map((c) => f[c])
    .find((v) => v !== undefined && v !== null);
  if (codigo === undefined || etiqueta === undefined) return null;

  const ordenCrudo = mapeo.campoOrden ? f[mapeo.campoOrden] : undefined;
  const orden =
    typeof ordenCrudo === 'number' && Number.isFinite(ordenCrudo)
      ? ordenCrudo
      : 0;

  return { codigo: String(codigo), etiqueta: String(etiqueta), orden };
}

export function ordenarOpciones(
  opciones: OpcionExterna[],
  mapeo: MapeoRespuestaExterna,
): OpcionExterna[] {
  return opciones.slice().sort((a, b) => {
    if (a.orden !== b.orden) return a.orden - b.orden;
    if (!mapeo.ordenarAlfabetico) return 0;
    return a.etiqueta.localeCompare(b.etiqueta, 'es', {
      sensitivity: 'base',
      numeric: true,
    });
  });
}

/** extraerFilas -> normalizar (descarta inválidas/inactivas) -> ordenar. Única función que llama el servicio. */
export function normalizarRespuesta(
  cuerpo: unknown,
  mapeo: MapeoRespuestaExterna,
): OpcionExterna[] {
  const filas = extraerFilas(cuerpo, mapeo);
  const opciones = filas
    .map((f) => normalizarFilaExterna(f, mapeo))
    .filter((o): o is OpcionExterna => o !== null);
  return ordenarOpciones(opciones, mapeo);
}
