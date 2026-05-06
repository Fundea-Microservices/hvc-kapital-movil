import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { apiClient } from '../../../core/network/apiClient';

/**
 * Función auxiliar para asegurar que siempre existan los arreglos created, updated y deleted.
 * Esto evita el error "Cannot read property 'length' of undefined".
 */
const safeMap = (tableObj: any, idKey: string) => ({
  created: (tableObj?.created || []).map((row: any) => ({ 
    ...row, 
    id: row[idKey]?.toString() || row.id?.toString() 
  })),
  updated: (tableObj?.updated || []).map((row: any) => ({ 
    ...row, 
    id: row[idKey]?.toString() || row.id?.toString() 
  })),
  deleted: tableObj?.deleted || []
});

export const runFullSync = async () => {
  try {
    await synchronize({
      database,
      pullChanges: async ({ lastPulledAt }) => {
        const syncDate = lastPulledAt ? new Date(lastPulledAt).toISOString() : null;

        // Peticiones paralelas al backend
        const [coreRes, structureRes, catalogsRes] = await Promise.all([
          apiClient.post('/sync/deltas', {
            lastSyncDates: { cat_menu_appex: syncDate, cat_parametros_appex: syncDate }
          }),
          apiClient.post('/surveys/structure', { lastSyncDate: syncDate }),
          apiClient.post('/surveys/catalogs', { lastSyncDate: syncDate })
        ]);

        // Extraemos los objetos de cambios (o un objeto vacío si fallan)
        const structChanges = structureRes.data?.changes || {};
        const coreChanges = coreRes.data?.changes || {};
        const catChanges = catalogsRes.data?.changes || {};

        /**
         * FUSIÓN Y MAPEO DE TABLAS
         * Mapeamos del nombre del Servidor (PascalCase) al nombre Local (Snake_case)
         */
        const mergedChanges = {
          // 1. Menú y Parámetros (Core)
          cat_menu_appex: safeMap(coreChanges.cat_menu_appex, 'id'),
          cat_parametros_appex: safeMap(coreChanges.cat_parametros_appex, 'id'),

          // 2. Estructura de Encuestas (Mapeo de IDs específicos de SQL)
          local_encuesta: safeMap(structChanges.Local_Encuesta, 'IdEncuesta'),
          local_seccion: safeMap(structChanges.Local_Seccion, 'IdSeccion'),
          local_estructura_pregunta: safeMap(structChanges.Local_Estructura_Pregunta, 'IdPregunta'),

          // 3. Catálogos (Si el servidor los envía bajo llaves específicas, añadirlas aquí)
          ...catChanges 
        };

        // Calculamos el timestamp más reciente
        const maxTimestamp = Math.max(
          new Date(coreRes.data?.timestamp || 0).getTime(),
          new Date(structureRes.data?.timestamp || 0).getTime(),
          new Date(catalogsRes.data?.timestamp || 0).getTime(),
          Date.now() // Fallback al tiempo actual
        );

        return { changes: mergedChanges, timestamp: maxTimestamp };
      },
      
      pushChanges: async ({ changes }) => {
        const respuestasToPush = (changes as any).local_captura;
        
        if (respuestasToPush && (respuestasToPush.created.length > 0 || respuestasToPush.updated.length > 0)) {
           await apiClient.post('/surveys/submit', { 
             idEncuesta: 1, 
             respuestas: [...respuestasToPush.created, ...respuestasToPush.updated] 
           });
        }
      },
    });

    // ACK de éxito
    await apiClient.post('/sync/ack', { tablaNombre: 'Todas', exitoso: true });
    console.log("🚀 Sincronización Total ejecutada con éxito.");

  } catch (error) {
    console.error("❌ Error crítico durante la sincronización:", error);
    
    await apiClient.post('/sync/ack', { tablaNombre: 'Todas', exitoso: false }).catch(() => {});
    throw error;
  }
};