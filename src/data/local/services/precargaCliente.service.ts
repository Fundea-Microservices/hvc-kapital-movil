import { Q } from '@nozbe/watermelondb';
import { database } from '../database';
import LocalClientePendiente from '../models/LocalClientePendiente';
import { leerRaw, type RawBase } from '../types/raw.types';
import { parsearValoresPrecarga, type ValorPrecargado } from '../../../domain/agenda/precarga';

/**
 * Lectura de los valores con los que BackOffice prellena un formulario.
 *
 * Vive en la capa de datos para que la pantalla no consulte la base por su cuenta: solo
 * pide "los valores de este cliente" y recibe el contrato del dominio ya interpretado.
 *
 * NUNCA lanza. Un fallo aquí solo debe costar el prellenado —el asesor puede teclear
 * los datos— y jamás impedir que la encuesta se abra.
 */
export const obtenerPrecarga = async (idCliente: string | null | undefined): Promise<ValorPrecargado[]> => {
  if (!idCliente) return [];

  try {
    const filas = await database.collections
      .get<LocalClientePendiente>('local_cliente_pendiente')
      .query(Q.where('id_cliente', idCliente))
      .fetch();

    if (filas.length === 0) return [];

    // Doble lectura modelo + `_raw`: el decorador devuelve `undefined` para columnas
    // añadidas por migración en registros creados antes de ella, y una tarjeta ad-hoc
    // anterior a la v10 es exactamente ese caso.
    const modelo = filas[0];
    const raw = leerRaw<RawBase>(modelo);
    return parsearValoresPrecarga(modelo.valores_json ?? raw.valores_json);
  } catch (e) {
    console.warn('[PRECARGA] No se pudieron leer los valores precargados del cliente:', e);
    return [];
  }
};
