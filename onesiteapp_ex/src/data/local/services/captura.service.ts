import { database } from '../database';
import { Q } from '@nozbe/watermelondb';
import LocalCaptura from '../models/LocalCaptura';

/**
 * Servicio encargado del Auto-Save (S3.3). Guarda inmediatamente cada respuesta en SQLite.
 */
export const saveRespuestaOffline = async (idPregunta: string, valor: string, uuidInstancia: string | null = null) => {
  try {
    await database.write(async () => {
      const capturaCollection = database.collections.get<LocalCaptura>('local_captura');
      
      // Buscar si ya existe una respuesta para esta pregunta (y esta fila de matriz, si aplica)
      const query = uuidInstancia 
        ? [Q.where('id_pregunta', idPregunta), Q.where('uuid_instancia', uuidInstancia)]
        : [Q.where('id_pregunta', idPregunta), Q.where('uuid_instancia', null)];

      const records = await capturaCollection.query(...query).fetch();

      if (records.length > 0) {
        // Actualizar respuesta existente
        await records[0].update((record) => {
          record.valor = valor;
          record.estado_sincro = 0; // Se marca como pendiente de sincronizar [cite: 43]
        });
      } else {
        // Crear nueva respuesta
        await capturaCollection.create((record) => {
          record.id_pregunta = idPregunta;
          record.valor = valor;
          record.uuid_instancia = uuidInstancia;
          record.estado_sincro = 0;
        });
      }
    });
  } catch (error) {
    console.error("Error crítico en Auto-Save:", error);
  }
};