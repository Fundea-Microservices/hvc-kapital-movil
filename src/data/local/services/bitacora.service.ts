import { Q } from '@nozbe/watermelondb';
import { Platform } from 'react-native';
import * as Application from 'expo-application';

import { database } from '../database';
import LocalBitacoraError from '../models/LocalBitacoraError';
import {
  construirEntrada,
  epochDeCaducidad,
  excedenteAPodar,
  MAXIMO_FILAS,
  type NivelBitacora,
} from '../../../domain/diagnostico/bitacora';

/** Mismos códigos que `local_multimedia`, para no recordar dos convenciones. */
export const ESTADO_BITACORA = { PENDIENTE: 0, ENVIADO: 2 } as const;

const coleccion = () => database.get<LocalBitacoraError>('local_bitacora_error');

/**
 * Registra un error para enviarlo en la próxima sincronización.
 *
 * NUNCA LANZA. Es la regla central de este servicio: un fallo del diagnóstico no puede
 * romper la operación que lo estaba reportando. Si la bitácora no puede escribir, se
 * cae a `console.error` y la aplicación sigue.
 *
 * @param origen  Punto del código: `syncManager.FASE1`, `multimedia.subida`…
 * @param contexto Solo escalares. Ver `sanearContexto`: los objetos anidados se
 *                 descartan a propósito para que nadie vuelque respuestas del
 *                 encuestado "por si acaso".
 */
export const registrarError = async (
  origen: string,
  error: unknown,
  contexto?: Record<string, unknown> | null,
  nivel: NivelBitacora = 'ERROR',
): Promise<void> => {
  try {
    const entrada = construirEntrada(nivel, origen, error, contexto);

    await database.write(async () => {
      await coleccion().create(fila => {
        fila.nivel = entrada.nivel;
        fila.origen = entrada.origen;
        fila.mensaje = entrada.mensaje;
        fila.detalle = entrada.detalle;
        fila.contexto_json = entrada.contexto ? JSON.stringify(entrada.contexto) : null;
        // Sin la versión no se puede saber si un error ya está corregido en una
        // build posterior, que es la primera pregunta al revisar la bitácora.
        fila.version_app = Application.nativeApplicationVersion || '0.0.0';
        fila.plataforma = Platform.OS;
        fila.epoch_ms = Date.now();
        fila.estado_envio = ESTADO_BITACORA.PENDIENTE;
        fila.intentos = 0;
      });
    });
  } catch (fallo) {
    const detalle = fallo instanceof Error ? fallo.message : String(fallo);
    console.error(`❌ [Bitácora] No se pudo registrar el error de "${origen}": ${detalle}`);
  }
};

/** Atajo para degradaciones toleradas, que no interrumpieron nada. */
export const registrarAviso = (
  origen: string,
  error: unknown,
  contexto?: Record<string, unknown> | null,
): Promise<void> => registrarError(origen, error, contexto, 'WARN');

/** Entradas por enviar, de la más antigua a la más reciente. */
export const obtenerPendientes = async (limite: number): Promise<LocalBitacoraError[]> =>
  coleccion()
    .query(
      Q.where('estado_envio', ESTADO_BITACORA.PENDIENTE),
      Q.sortBy('epoch_ms', Q.asc),
      Q.take(limite),
    )
    .fetch();

export const contarPendientes = async (): Promise<number> =>
  coleccion().query(Q.where('estado_envio', ESTADO_BITACORA.PENDIENTE)).fetchCount();

/**
 * Marca como enviadas y las BORRA.
 *
 * Se borran en vez de conservarse: el servidor ya tiene la copia, y mantener el
 * histórico en el dispositivo solo consume el almacenamiento del asesor sin aportar
 * nada que no se pueda consultar en el BackOffice.
 */
export const marcarEnviadas = async (filas: LocalBitacoraError[]): Promise<void> => {
  if (filas.length === 0) return;
  await database.write(async () => {
    await database.batch(filas.map(fila => fila.prepareDestroyPermanently()));
  });
};

/** Suma un intento fallido, para no reintentar indefinidamente lo irrecuperable. */
export const registrarIntentoFallido = async (filas: LocalBitacoraError[]): Promise<void> => {
  if (filas.length === 0) return;
  await database.write(async () => {
    await database.batch(
      filas.map(fila => fila.prepareUpdate(f => { f.intentos = fila.intentos + 1; })),
    );
  });
};

/**
 * Mantenimiento: borra lo caducado y lo que exceda el tope.
 *
 * Sin esto, un dispositivo que pasa semanas sin señal con un error que se repite en
 * cada ciclo llena el almacenamiento del asesor. Se conservan las entradas MÁS
 * RECIENTES: un fallo repetido cientos de veces expulsaría a los demás, que son
 * justamente los que aportan información nueva.
 *
 * No lanza: es mantenimiento, no una operación de negocio.
 */
export const podarBitacora = async (): Promise<number> => {
  try {
    let borradas = 0;

    // 1. Caducadas por antigüedad.
    const caducadas = await coleccion()
      .query(Q.where('epoch_ms', Q.lt(epochDeCaducidad(Date.now()))))
      .fetch();

    if (caducadas.length > 0) {
      await database.write(async () => {
        await database.batch(caducadas.map(f => f.prepareDestroyPermanently()));
      });
      borradas += caducadas.length;
    }

    // 2. Excedente sobre el tope, empezando por las más antiguas.
    const total = await coleccion().query().fetchCount();
    const sobran = excedenteAPodar(total, MAXIMO_FILAS);

    if (sobran > 0) {
      const antiguas = await coleccion()
        .query(Q.sortBy('epoch_ms', Q.asc), Q.take(sobran))
        .fetch();

      await database.write(async () => {
        await database.batch(antiguas.map(f => f.prepareDestroyPermanently()));
      });
      borradas += antiguas.length;
    }

    if (borradas > 0) console.log(`🧹 [Bitácora] ${borradas} entrada(s) podadas`);
    return borradas;
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ [Bitácora] Poda incompleta: ${detalle}`);
    return 0;
  }
};
