import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { apiClient } from '../../../core/network/apiClient';

export const runIncrementalSync = async () => {
  try {
    await synchronize({
      database,
      // 1. pullChanges: TraerDeltas desde NestJS
      pullChanges: async ({ lastPulledAt, schemaVersion, migration }) => {
        // Convertimos el timestamp de Watermelon a ISO 8601 para NestJS
        const syncDate = lastPulledAt ? new Date(lastPulledAt).toISOString() : null;

        // Construimos el mapa de fechas que espera nuestro DTO del backend
        const lastSyncDates = {
          cat_menu_appex: syncDate,
          cat_parametros_appex: syncDate,
        };

        // Petición POST al endpoint que creamos
        const response = await apiClient.post('/sync/deltas', { lastSyncDates });

        if (!response.data || !response.data.changes) {
          throw new Error('Formato de deltas inválido recibido del servidor.');
        }

        const { changes, timestamp } = response.data;

        // Devolvemos los cambios y el timestamp del servidor para que Watermelon ejecute el UPSERT masivo
        return { changes, timestamp: new Date(timestamp).getTime() };
      },

      // 2. pushChanges: Enviar datos locales al servidor
      // En este sprint el flujo indica que solo consumimos catálogos, por lo que lo dejamos vacío.
      pushChanges: async ({ changes, lastPulledAt }) => {
         // Se implementará en sprints futuros para formularios o encuestas offline
      },

      // Opcional pero recomendado: forzar migraciones si es necesario
      //migrationsEnabledAtVersion: 1,
    });

    // 3. ConfirmarSinc (ACK) - Regla Crítica 3.2
    // Si la promesa de synchronize() se resuelve, el UPSERT fue 100% exitoso.
    await apiClient.post('/sync/ack', {
      tablaNombre: 'Todas',
      exitoso: true,
    });

    console.log("Sincronización incremental ejecutada con éxito.");

  } catch (error) {
    console.error("Error durante la sincronización:", error);
    
    // Opcional: Reportar ACK fallido al backend
    await apiClient.post('/sync/ack', {
      tablaNombre: 'Todas',
      exitoso: false,
    }).catch(() => {}); // Ignorar error si no hay red
  }
};