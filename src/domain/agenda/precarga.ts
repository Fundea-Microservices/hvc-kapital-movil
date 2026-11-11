import { normalizarComparacion } from '../encuesta/tipos';

/**
 * Interpretación de la precarga que BackOffice asigna a un asesor (`pre.Precarga`).
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
 */
export const ETIQUETAS_EXPEDIENTE: readonly string[] = [
  // 'codigo cliente' va PRIMERO porque es la etiqueta real de la encuesta en uso
  // (sección "Datos Pruebas")
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
 * Etiquetas candidatas para los campos que TAMBIÉN existen como columna,datos para cargar 
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
 */
export const MARCADORES_NOMBRE: readonly string[] = ['CLIENTE SIN NOMBRE', 'NUEVA ENCUESTA'];

/**
 * `true` si el nombre es un relleno y no un nombre de verdad.
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
 */
export const construirTextoBusqueda = (campos: CamposBuscables): string =>
  [campos.documento, campos.nombres, campos.cuenta, campos.operacion]
    .map((c) => normalizarComparacion(c))
    .filter((c) => c !== '')
    .join(' ');

/**
 * Normaliza una fecha de la precarga al formato interno de la app: `YYYY-MM-DD`.
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
