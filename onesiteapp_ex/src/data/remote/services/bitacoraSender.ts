import { apiClient } from '../../../core/network/apiClient';
import {
  contarPendientes,
  marcarEnviadas,
  obtenerPendientes,
  podarBitacora,
  registrarIntentoFallido,
} from '../../local/services/bitacora.service';
import { obtenerParametroNumerico } from '../../local/services/parametros.service';

export interface ResumenBitacora {
  enviadas: number;
  pendientes: number;
}

/** Tope de intentos antes de dejar de insistir con una entrada. */
const MAX_INTENTOS = 3;

/**
 * Envía la bitácora acumulada. Es la última fase del ciclo de sincronización.
 *
 * NUNCA LANZA, y va al final a propósito: el diagnóstico es lo menos importante del
 * ciclo. Si algo falla aquí, lo que no puede pasar es que se lleve por delante la
 * descarga de estructuras o el envío de capturas, que es el trabajo real del asesor.
 *
 * Se envía en UN SOLO lote, no una petición por entrada: en una red rural, cincuenta
 * peticiones sueltas tardan más que una con cincuenta elementos y multiplican las
 * ocasiones de fallar a medias.
 */
export const enviarBitacora = async (): Promise<ResumenBitacora> => {
  const resumen: ResumenBitacora = { enviadas: 0, pendientes: 0 };

  try {
    // La poda va primero: no tiene sentido intentar subir lo que ya caducó.
    await podarBitacora();

    const maxPorSync = await obtenerParametroNumerico('BITACORA_MAX_POR_SYNC', 50);
    const pendientes = await obtenerPendientes(maxPorSync);

    if (pendientes.length === 0) return resumen;

    // Las que agotaron los intentos se descartan: si el servidor lleva tres ciclos
    // rechazándolas, insistir solo consume datos del asesor. Se pierde diagnóstico,
    // nunca datos de campo.
    const agotadas = pendientes.filter(f => f.intentos >= MAX_INTENTOS);
    if (agotadas.length > 0) {
      console.warn(`⚠️ [Bitácora] ${agotadas.length} entrada(s) descartadas tras ${MAX_INTENTOS} intentos`);
      await marcarEnviadas(agotadas);
    }

    const enviables = pendientes.filter(f => f.intentos < MAX_INTENTOS);
    if (enviables.length === 0) return resumen;

    const lote = enviables.map(fila => ({
      nivel: fila.nivel,
      origen: fila.origen,
      mensaje: fila.mensaje,
      detalle: fila.detalle,
      contexto: fila.contexto_json,
      versionApp: fila.version_app,
      plataforma: fila.plataforma,
      // ISO-8601: el backend lo convierte a la zona de la operación en un único
      // punto, igual que las fechas de captura.
      fechaError: new Date(fila.epoch_ms).toISOString(),
    }));

    await apiClient.post('/diagnostics/errors', { errores: lote });
    await marcarEnviadas(enviables);

    resumen.enviadas = enviables.length;
    console.log(`📋 [Bitácora] ${resumen.enviadas} entrada(s) enviadas`);
  } catch (error) {
    // Se registra en consola y NO en la propia bitácora: un fallo al enviar que se
    // anota a sí mismo crea un bucle que crece con cada ciclo.
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ [Bitácora] No se pudo enviar: ${detalle}`);

    try {
      const pendientes = await obtenerPendientes(50);
      await registrarIntentoFallido(pendientes);
    } catch {
      // Sin acción: ya se avisó arriba.
    }
  }

  try {
    resumen.pendientes = await contarPendientes();
  } catch {
    // Sin acción.
  }

  return resumen;
};
