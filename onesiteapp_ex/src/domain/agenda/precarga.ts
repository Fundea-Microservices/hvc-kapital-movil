import { normalizarComparacion } from '../encuesta/tipos';

/**
 * Interpretación de la precarga que BackOffice asigna a un asesor (`pre.Precarga`).
 *
 * Todo lo de este archivo es PURO: sin React, sin WatermelonDB y sin red, de forma que
 * se prueba con Node plano. Es donde vive la parte frágil del contrato — un JSON que
 * escribe otro sistema y que puede llegar mal formado sin que nadie se entere.
 */

/** Un valor precargado para una pregunta concreta del formulario. */
export interface ValorPrecargado {
  /** Coincide con `local_estructura_pregunta.id` (el IdPregunta del BackOffice). */
  id_pregunta: string;
  etiqueta: string;
  valor: string;
}

/** Campos buscables de una fila de agenda. */
export interface CamposBuscables {
  documento: string | null;
  nombres: string | null;
  cuenta: string | null;
  operacion: string | null;
}

/**
 * Etiquetas candidatas para el código de expediente, en orden de preferencia.
 *
 * BackOffice no entrega el expediente como columna: viaja dentro de `valores`, así que
 * hay que reconocerlo por su etiqueta. Es el mismo criterio que ya usa
 * `PRIORIDAD_ETIQUETAS` para deducir el nombre de la tarjeta.
 */
export const ETIQUETAS_EXPEDIENTE: readonly string[] = [
  // 'codigo cliente' va PRIMERO porque es la etiqueta real de la encuesta en uso
  // (sección "Datos Pruebas"); las de expediente se conservan porque el requisito
  // las nombra así y otras encuestas pueden usarlas.
  'codigo cliente',
  'codigo de cliente',
  'codigo de expediente',
  'numero de expediente',
  'no. de expediente',
  'no. expediente',
  'expediente',
  'codigo',
];

/**
 * Etiquetas candidatas para los campos que TAMBIÉN existen como columna plana.
 *
 * POR QUÉ HACEN FALTA SI YA HAY COLUMNA
 * La configuración de precarga del BackOffice decide, por encuesta, qué columna del
 * Excel alimenta qué pregunta — y no siempre rellena además la columna plana
 * equivalente. Comprobado con dos cargas reales del mismo despliegue:
 *
 *   · Carga 1 (Excel con DPI):     documento="1111111110401", nombres=null
 *   · Carga 2 (Excel con Nombre):  documento=null,            nombres=null
 *                                  y el nombre viajando SOLO en valores (pregunta 288)
 *
 * Es decir, `nombres` llegó nulo en ambas aunque el segundo Excel sí traía el nombre.
 * Leer únicamente la columna plana dejaba la agenda entera en "CLIENTE SIN NOMBRE" con
 * el dato disponible a un cruce de distancia. La columna sigue teniendo prioridad; esto
 * es el respaldo.
 */
export const ETIQUETAS_NOMBRE: readonly string[] = [
  'nombre completo',
  'nombres',
  'nombre del cliente',
  'nombre',
];

export const ETIQUETAS_DOCUMENTO: readonly string[] = [
  'dpi',
  'nit',
  'dpi/nit',
  'documento',
  'no. documento',
  'numero de documento',
  'identificacion',
  'cui',
];

export const ETIQUETAS_CUENTA: readonly string[] = [
  'no. cuenta',
  'numero de cuenta',
  'no cuenta',
  'cuenta',
];

export const ETIQUETAS_OPERACION: readonly string[] = [
  'no. operacion',
  'numero de operacion',
  'no operacion',
  'operacion',
];

/** Etiquetas candidatas para la ubicación o comunidad, en orden de preferencia. */
export const ETIQUETAS_UBICACION: readonly string[] = [
  'ubicacion',
  'comunidad',
  'aldea',
  'caserio',
  'localidad',
  'direccion',
  'municipio',
  'departamento',
];

/**
 * Convierte el campo `valores` en una lista utilizable.
 *
 * NUNCA lanza. La configuración externa emite JSON inválido con cierta frecuencia y un
 * throw aquí abortaría la sincronización de toda la cartera por una sola fila mal
 * escrita: se prefiere perder el prellenado de ese cliente a perder la agenda entera.
 * Acepta tanto la cadena JSON como el array ya deserializado, porque el servidor puede
 * mandar cualquiera de los dos según cómo serialice la columna.
 */
export const parsearValoresPrecarga = (origen: unknown): ValorPrecargado[] => {
  let bruto: unknown = origen;

  if (typeof origen === 'string') {
    const texto = origen.trim();
    if (texto === '') return [];
    try {
      bruto = JSON.parse(texto);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(bruto)) return [];

  const salida: ValorPrecargado[] = [];
  for (const fila of bruto) {
    if (typeof fila !== 'object' || fila === null || Array.isArray(fila)) continue;
    const registro = fila as Record<string, unknown>;

    // El id llega como número en el ejemplo del BackOffice, pero la app compara contra
    // `local_estructura_pregunta.id`, que es string: se normaliza aquí, una sola vez.
    const idCrudo = registro.id_pregunta ?? registro.idPregunta ?? registro.IdPregunta;
    if (idCrudo === undefined || idCrudo === null || idCrudo === '') continue;

    const valorCrudo = registro.valor ?? registro.Valor;
    if (valorCrudo === undefined || valorCrudo === null) continue;

    salida.push({
      id_pregunta: String(idCrudo),
      etiqueta: String(registro.etiqueta ?? registro.Etiqueta ?? ''),
      valor: String(valorCrudo),
    });
  }
  return salida;
};

/**
 * Textos que ocupan el lugar de un nombre sin serlo.
 *
 * `CLIENTE SIN NOMBRE` lo pone el adaptador cuando la precarga no trae nombre;
 * `NUEVA ENCUESTA` lo pone la pantalla del formulario al crear una tarjeta ad-hoc
 * todavía vacía. Ninguno identifica a nadie.
 */
export const MARCADORES_NOMBRE: readonly string[] = ['CLIENTE SIN NOMBRE', 'NUEVA ENCUESTA'];

/**
 * `true` si el nombre es un relleno y no un nombre de verdad.
 *
 * Se usa en los DOS sentidos de la misma regla, y por eso vive aquí en vez de estar
 * repetida en cada lado:
 *   · La pantalla del formulario asciende marcador → nombre capturado.
 *   · La recarga de cartera NO desciende nombre real → marcador del servidor.
 * Si cada sitio tuviera su propia lista, bastaría con actualizar una para que la
 * tarjeta volviera a "parpadear" entre los dos valores en cada sincronización.
 *
 * El documento cuenta como marcador porque la tarjeta lo usa de sustituto cuando no
 * hay nombre: mostrar el DPI es mejor que un texto genérico, pero sigue sin ser un
 * nombre, y tratarlo como tal impediría que el capturado lo reemplazara.
 */
export const esNombreMarcador = (
  nombre: string | null | undefined,
  documento?: string | null,
): boolean => {
  const limpio = (nombre || '').trim();
  if (limpio === '') return true;
  if (MARCADORES_NOMBRE.includes(limpio.toUpperCase())) return true;
  const doc = (documento || '').trim();
  return doc !== '' && limpio === doc;
};

/**
 * Rellena la etiqueta de cada valor a partir del catálogo local de preguntas.
 *
 * POR QUÉ HACE FALTA
 * El Excel de especificación describía `valores` como `[{id_pregunta, etiqueta, valor}]`,
 * pero el servicio real NO envía `etiqueta`: manda
 * `{id, id_pregunta, id_encuesta, valor, uuid_instancia, estado_sincro, …}`. Sin este
 * paso, cualquier resolución por etiqueta encontraría siempre cadena vacía.
 *
 * POR QUÉ POR ETIQUETA Y NO POR `id_pregunta` CONFIGURADO
 * Los identificadores son distintos en cada encuesta (287 y 289 en la encuesta 5), así
 * que una lista fija de ids solo serviría para una y habría que tocarla al publicar la
 * siguiente. La etiqueta es estable entre encuestas y ya viaja sincronizada en
 * `local_estructura_pregunta`, así que el emparejamiento sigue siendo parametrizable
 * desde `cat_parametros_appex` sin depender de ids.
 *
 * Solo rellena las vacías: si algún día el servicio empieza a mandar `etiqueta`, esa
 * gana sobre la local.
 */
export const enriquecerConEtiquetas = (
  valores: readonly ValorPrecargado[],
  etiquetasPorPregunta: ReadonlyMap<string, string>,
): ValorPrecargado[] =>
  valores.map((v) =>
    v.etiqueta.trim() !== ''
      ? v
      : { ...v, etiqueta: etiquetasPorPregunta.get(v.id_pregunta) ?? '' },
  );

/**
 * Busca el primer valor cuya etiqueta case con alguna de las candidatas.
 *
 * La comparación va sin acentos ni mayúsculas en AMBOS lados: BackOffice escribe
 * "Ubicación" y la lista de candidatas usa "ubicacion". Se recorren las candidatas por
 * orden (no los valores) para que la preferencia declarada mande de verdad.
 */
export const resolverEtiqueta = (
  valores: readonly ValorPrecargado[],
  candidatas: readonly string[],
): string | null => {
  for (const candidata of candidatas) {
    const objetivo = normalizarComparacion(candidata);
    if (objetivo === '') continue;
    const hallado = valores.find((v) => normalizarComparacion(v.etiqueta) === objetivo);
    if (hallado && hallado.valor.trim() !== '') return hallado.valor.trim();
  }
  return null;
};

/**
 * Construye el pajar contra el que busca la agenda.
 *
 * Se calcula una sola vez, al sincronizar, en lugar de normalizar cuatro campos de cada
 * fila en cada pulsación de tecla. Los campos van separados por espacio para que una
 * consulta no case a caballo entre el final de uno y el principio del siguiente.
 */
export const construirTextoBusqueda = (campos: CamposBuscables): string =>
  [campos.documento, campos.nombres, campos.cuenta, campos.operacion]
    .map((c) => normalizarComparacion(c))
    .filter((c) => c !== '')
    .join(' ');

/**
 * Normaliza una fecha de la precarga al formato interno de la app: `YYYY-MM-DD`.
 *
 * POR QUÉ
 * La app guarda fechas como `YYYY-MM-DD` y las pinta con `new Date(valor + 'T00:00:00')`.
 * El BackOffice manda la fecha de precarga en `DD/MM/YYYY` (ej. `01/01/1980`) o, según
 * el origen, como datetime ISO con hora. Sembrar ese valor tal cual producía
 * "Invalid Date" en el input. Aquí se lleva a `YYYY-MM-DD` antes de sembrar.
 *
 * Ante algo que no se puede interpretar devuelve `null`: el llamador NO siembra y el
 * campo queda vacío ("Seleccione una fecha…") en vez de mostrar "Invalid Date" — la
 * regla de degradar visible del prellenado.
 */
export const normalizarFechaISO = (valor: string | null | undefined): string | null => {
  const v = (valor ?? '').trim();
  if (v === '') return null;

  // Ya es ISO (fecha o datetime): se toma la parte de fecha.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DD/MM/YYYY o D/M/YYYY (formato del BackOffice); también día-primero con guiones.
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (dmy) {
    const dia = dmy[1].padStart(2, '0');
    const mes = dmy[2].padStart(2, '0');
    if (Number(mes) >= 1 && Number(mes) <= 12 && Number(dia) >= 1 && Number(dia) <= 31) {
      return `${dmy[3]}-${mes}-${dia}`;
    }
  }

  // Último recurso: que lo intente Date. Si es válido se formatea en UTC (no correr el
  // día por zona horaria). Si no, null — nunca "Invalid Date".
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return new Date(t).toISOString().split('T')[0];
  return null;
};
