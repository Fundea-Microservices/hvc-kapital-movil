import { Q } from '@nozbe/watermelondb';
import { database } from '../database';
import CatParametros from '../models/CatParametros';
import { leerRaw, type RawBase } from '../types/raw.types';

/**
 * Lee la tabla local `cat_parametros_appex` — poblada vía /sync/deltas desde
 * Cat_Parametros_AppEx del servidor — para permitir cambiar comportamientos de la
 * app SIN publicar una nueva versión en la tienda.
 */
export const obtenerParametro = async (clave: string, porDefecto: string): Promise<string> => {
  try {
    const filas = await database.collections
      .get<CatParametros>('cat_parametros_appex')
      .query(Q.where('clave', clave))
      .fetch();

    const valor = filas.length > 0 ? (filas[0].valor ?? leerRaw<RawBase>(filas[0]).valor) : undefined;
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return porDefecto;
    }
    return String(valor).trim();
  } catch (e) {
    console.warn('[PARAMETROS] Error leyendo clave; se usa el valor por defecto. Clave:', clave, e);
    return porDefecto;
  }
};

/** Variante numérica: valores no numéricos o ausentes caen al defecto. */
export const obtenerParametroNumerico = async (clave: string, porDefecto: number): Promise<number> => {
  const crudo = await obtenerParametro(clave, String(porDefecto));
  const parseado = parseFloat(crudo);
  return isNaN(parseado) ? porDefecto : parseado;
};
