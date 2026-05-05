import { database } from '../database';
import { Q } from '@nozbe/watermelondb';
import LocalCaptura from '../models/LocalCaptura';
import { submitSurveyApi } from '../../remote/surveys.api';

/**
 * El servicio genera el objeto sendSurvey que incluye encabezado, respuestas planas y respuestas de matrices (S5.1).
 */
export const buildAndSyncSurvey = async (idEncuesta: string) => {
  try {
    const capturaCollection = database.collections.get<LocalCaptura>('local_captura');
    
    // 1. Extraer solo las respuestas pendientes de sincronizar (EstadoSincro = 0)
    const respuestasPendientes = await capturaCollection.query(
      Q.where('estado_sincro', 0)
    ).fetch();

    if (respuestasPendientes.length === 0) {
      return { success: true, message: 'No hay datos nuevos para sincronizar' };
    }

    // 2. Construir el Payload (JSON Bulk Builder)
    const payload = {
      idEncuesta: idEncuesta,
      respuestas: respuestasPendientes.map(r => ({
        idPregunta: r.id_pregunta,
        valor: r.valor,
        uuidInstancia: r.uuid_instancia
      }))
    };

    // 3. Envío al Servidor (S5.2)
    await submitSurveyApi(payload);

    // 4. Lógica de Cierre y Limpieza (ACK Logic S5.4)
    // Tras recibir 200 OK, se marca EstadoSincro=1 en la base de datos local.
    await database.write(async () => {
      for (const record of respuestasPendientes) {
        await record.update(r => {
          r.estado_sincro = 1;
        });
      }
    });

    return { success: true, folio: Math.floor(Math.random() * 10000) }; // Folio simulado
  } catch (error) {
    console.error("Error en sincronización de cierre:", error);
    throw error;
  }
};