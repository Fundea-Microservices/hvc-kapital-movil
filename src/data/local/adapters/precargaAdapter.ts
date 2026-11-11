import { leerCampo, textoDe, type FilaServidor } from '../../remote/types/sync.types';
import {
  enriquecerConEtiquetas,
  parsearValoresPrecarga,
  resolverEtiqueta,
  construirTextoBusqueda,
  ETIQUETAS_EXPEDIENTE,
  ETIQUETAS_UBICACION,
  ETIQUETAS_NOMBRE,
  ETIQUETAS_DOCUMENTO,
  ETIQUETAS_CUENTA,
  ETIQUETAS_OPERACION,
} from '../../../domain/agenda/precarga';

/**
 * Frontera entre `pre.Precarga` del BackOffice y la tabla local.
 *
 * Aquí ocurre TODA la tolerancia de nombres. El servidor entrega las columnas en tres
 * cajas distintas (snake_case, camelCase y el PascalCase de SQL Server) y, en el caso
 * de `operación`, además con tilde. Un alias que falte no da error: deja el campo en
 * `null` con un backend perfectamente sano, que es el fallo más caro de diagnosticar
 * de este proyecto. Por eso se declaran todas las variantes plausibles.
 */

/** Fila de agenda ya normalizada, lista para escribirse en `local_cliente_pendiente`. */
export interface ClienteAsignado {
  id_cliente: string;
  id_encuesta: string;
  nombre: string;
  documento: string | null;
  cuenta: string | null;
  operacion: string | null;
  expediente: string | null;
  ubicacion: string | null;
  busqueda_normalizada: string;
  valores_json: string | null;
  estado_servidor: string | null;
  /** Solo se aplica al CREAR la fila; en un update manda el estado del asesor. */
  estado_gestion_inicial: number;
}

/** Listas de etiquetas con las que se reconocen expediente y ubicación en `valores`. */
export interface EtiquetasTarjeta {
  expediente: readonly string[];
  ubicacion: readonly string[];
  nombre: readonly string[];
  documento: readonly string[];
  cuenta: readonly string[];
  operacion: readonly string[];
}

export const ETIQUETAS_POR_DEFECTO: EtiquetasTarjeta = {
  expediente: ETIQUETAS_EXPEDIENTE,
  ubicacion: ETIQUETAS_UBICACION,
  nombre: ETIQUETAS_NOMBRE,
  documento: ETIQUETAS_DOCUMENTO,
  cuenta: ETIQUETAS_CUENTA,
  operacion: ETIQUETAS_OPERACION,
};

/** 0 Pendiente | 1 Gestionado | 2 Cancelado. */
const GESTION_PENDIENTE = 0;
const GESTION_COMPLETADO = 1;
const GESTION_CANCELADO = 2;

/** Estados del BackOffice que significan "esta asignación ya no aplica". */
export const ESTADOS_REVOCADOS = ['ANULADO', 'RECHAZADO'];

/** Traduce el enum del BackOffice al entero local. Desconocido = pendiente. */
export const gestionDesdeEstado = (estado: string | null): number => {
  switch ((estado || '').trim().toUpperCase()) {
    case 'APLICADO':
    case 'FINALIZADO':
      return GESTION_COMPLETADO;
    case 'ANULADO':
    case 'RECHAZADO':
      return GESTION_CANCELADO;
    default:
      return GESTION_PENDIENTE;
  }
};

/** `true` si BackOffice retiró la asignación. */
export const estaRevocado = (estado: string | null): boolean =>
  ESTADOS_REVOCADOS.includes((estado || '').trim().toUpperCase());

/**
 * Serializa el campo `valores`.
 *
 * No se usa `textoDe` porque haría `String(array)`, que produce "[object Object]" y
 * destruiría el prellenado en silencio. El servidor puede mandar la columna JSON ya
 * deserializada o como cadena, según cómo la exponga; se admiten las dos.
 */
const serializarValores = (fila: FilaServidor): string | null => {
  const bruto = leerCampo(fila, 'valores', 'Valores', 'valores_json', 'valoresJson');
  if (bruto === null) return null;
  if (typeof bruto === 'string') return bruto.trim() === '' ? null : bruto;
  try {
    return JSON.stringify(bruto);
  } catch {
    return null;
  }
};

/**
 * Convierte una fila del servidor. Devuelve `null` si no trae identificador: sin él no
 * se puede hacer upsert ni correlacionar la captura, y crear una fila con id inventado
 * generaría duplicados en cada sincronización.
 */
export const aClienteAsignado = (
  fila: FilaServidor,
  etiquetas: EtiquetasTarjeta = ETIQUETAS_POR_DEFECTO,
  /**
   * `id_pregunta` → `etiqueta`, tomado de `local_estructura_pregunta`. El servicio no
   * manda la etiqueta dentro de `valores`, así que sin este mapa el expediente y la
   * ubicación de la tarjeta quedarían siempre vacíos. Por defecto vacío para que el
   * adaptador siga siendo usable en pruebas sin base de datos.
   */
  etiquetasPorPregunta: ReadonlyMap<string, string> = new Map(),
): ClienteAsignado | null => {
  const idCliente = textoDe(fila, 'id', 'Id', 'ID', 'id_precarga', 'idPrecarga', 'IdPrecarga');
  if (!idCliente) return null;

  const idEncuesta = textoDe(fila, 'id_encuesta', 'idEncuesta', 'IdEncuesta');
  if (!idEncuesta) return null;

  const estadoServidor = textoDe(fila, 'estado', 'Estado');

  const valoresJson = serializarValores(fila);
  const valores = enriquecerConEtiquetas(parsearValoresPrecarga(valoresJson), etiquetasPorPregunta);

  /**
   * Columna plana primero, respaldo en `valores` después.
   *
   * La configuración de precarga no siempre rellena la columna equivalente a la
   * pregunta: en las cargas reales `nombres` llegó `null` incluso con el Excel
   * trayendo "Nombre Completo", porque ese dato fue SOLO a `valores`. Sin este
   * respaldo la tarjeta mostraba "CLIENTE SIN NOMBRE" teniendo el nombre a mano.
   */
  const conRespaldo = (columna: string | null, candidatas: readonly string[]): string | null =>
    (columna || '').trim() !== '' ? columna : resolverEtiqueta(valores, candidatas);

  const documento = conRespaldo(textoDe(fila, 'documento', 'Documento'), etiquetas.documento);
  const nombres = conRespaldo(
    textoDe(fila, 'nombres', 'nombre', 'Nombres', 'Nombre', 'nombre_completo', 'NombreCompleto'),
    etiquetas.nombre,
  );
  const cuenta = conRespaldo(textoDe(fila, 'cuenta', 'Cuenta', 'no_cuenta', 'noCuenta'), etiquetas.cuenta);
  // 'operación' con tilde es el nombre REAL de la columna en el BackOffice.
  const operacion = conRespaldo(
    textoDe(fila, 'operacion', 'operación', 'Operacion', 'Operación', 'operation', 'noOperacion'),
    etiquetas.operacion,
  );

  return {
    id_cliente: idCliente,
    id_encuesta: idEncuesta,
    // Sin nombre la tarjeta quedaría en blanco. Se cae al DOCUMENTO antes que a un
    // texto genérico: en los datos reales del servicio `nombres` llega `null` con
    // frecuencia, y una agenda entera de "CLIENTE SIN NOMBRE" es inservible, mientras
    // que el DPI/NIT sí permite al asesor identificar a quién tiene delante.
    // vez de descartar la fila, que dejaría al asesor sin poder gestionar al cliente.
    nombre:
      (nombres || '').trim() !== ''
        ? String(nombres).trim()
        : (documento || '').trim() !== ''
          ? String(documento).trim()
          : 'CLIENTE SIN NOMBRE',
    documento,
    cuenta,
    operacion,
    expediente: resolverEtiqueta(valores, etiquetas.expediente),
    ubicacion: resolverEtiqueta(valores, etiquetas.ubicacion),
    busqueda_normalizada: construirTextoBusqueda({ documento, nombres, cuenta, operacion }),
    valores_json: valoresJson,
    estado_servidor: estadoServidor,
    estado_gestion_inicial: gestionDesdeEstado(estadoServidor),
  };
};
