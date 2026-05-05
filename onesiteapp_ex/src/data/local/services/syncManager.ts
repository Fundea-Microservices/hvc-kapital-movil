import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { apiClient } from '../../../core/network/apiClient';

/**
 * El sistema ejecuta la sincronización maestra (Core, Estructura y Catálogos) 
 * en una sola transacción unificada para garantizar la integridad de SQLite.
 */
export const runIncrementalSync = async () => {
  try {
    await synchronize({
      database,
      // 1. pullChanges: Traer todos los Deltas en paralelo
      pullChanges: async ({ lastPulledAt }) => {
        const syncDate = lastPulledAt ? new Date(lastPulledAt).toISOString() : null;

        // Se ejecutan las 3 peticiones al mismo tiempo para maximizar la velocidad de red
        const [coreRes, structureRes, catalogsRes] = await Promise.all([
          apiClient.post('/sync/deltas', {
            lastSyncDates: {
              cat_menu_appex: syncDate,
              cat_parametros_appex: syncDate,
            }
          }),
          apiClient.post('/surveys/structure', { lastSyncDate: syncDate }),
          apiClient.post('/surveys/catalogs', { lastSyncDate: syncDate }) // Integración del Sprint 6
        ]);

        // Se valida que todos los microservicios hayan respondido correctamente
        if (!coreRes.data?.changes || !structureRes.data?.changes || !catalogsRes.data?.changes) {
          throw new Error('Formato de deltas inválido recibido en uno de los microservicios.');
        }

        // Se fusionan (Merge) todos los cambios en un solo objeto maestro para el UPSERT
        const mergedChanges = {
          ...coreRes.data.changes,
          ...structureRes.data.changes,
          ...catalogsRes.data.changes,
        };

        // Se determina el timestamp más reciente para guardar en la memoria de Watermelon
        const maxTimestamp = Math.max(
          new Date(coreRes.data.timestamp).getTime(),
          new Date(structureRes.data.timestamp).getTime(),
          new Date(catalogsRes.data.timestamp).getTime()
        );

        return { changes: mergedChanges, timestamp: maxTimestamp };
      },
      
      // 2. pushChanges: Enviar datos locales al servidor (Pendiente Sprint 9)
      pushChanges: async () => {
        // En este sprint solo descargamos estructura y catálogos.
      },
      
      migrationsEnabledAtVersion: 1,
    });

    // 3. ConfirmarSinc (ACK) - Solo se envía si TODA la sincronización fue exitosa
    await apiClient.post('/sync/ack', {
      tablaNombre: 'Todas',
      exitoso: true,
    });

    console.log("Sincronización Total (Core + SGRAS) ejecutada con éxito.");

  } catch (error) {
    console.error("Error crítico durante la sincronización:", error);
    
    // Reporte de ACK fallido al backend
    await apiClient.post('/sync/ack', {
      tablaNombre: 'Todas',
      exitoso: false,
    }).catch(() => {}); // Ignorar error si no hay red
    
    throw error; // Propagar el error para que la UI (ej. LoginScreen) pueda reaccionar
  }
};