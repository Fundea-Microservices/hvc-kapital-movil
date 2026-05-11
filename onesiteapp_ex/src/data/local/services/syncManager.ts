import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { apiClient } from '../../../core/network/apiClient';
import { Q } from '@nozbe/watermelondb';

export const runFullSync = async () => {
  console.log('🔄 [SYNC] Iniciando sincronización...');

  try {
    await synchronize({
      database,

      // =========================================================
      // PULL: DESCARGA DE DATOS DESDE EL SERVIDOR (SQL -> SQLite)
      // =========================================================
      pullChanges: async ({ lastPulledAt }) => {
        console.log('📥 [SYNC PULL] Obteniendo cambios del servidor...');
        const syncDate = lastPulledAt ? new Date(lastPulledAt).toISOString() : null;

        // 1. Peticiones al backend
        const [coreRes, structureRes, catalogsRes] = await Promise.all([
          apiClient.post('/sync/deltas', { lastSyncDates: { cat_menu_appex: syncDate, cat_parametros_appex: syncDate } }),
          apiClient.post('/surveys/structure', { lastSyncDate: syncDate }),
          apiClient.post('/surveys/catalogs', { lastSyncDate: syncDate })
        ]);

        const structChanges = structureRes.data?.changes || {};
        const coreChanges = coreRes.data?.changes || {};
        const catChanges = catalogsRes.data?.changes || {};

        // Función utilitaria para encontrar la llave correcta del servidor
        const getTableData = (obj: any, posiblesNombres: string[]) => {
          for (const nombre of posiblesNombres) {
            if (obj[nombre]) return obj[nombre];
          }
          return { created: [], updated: [], deleted: [] };
        };

        // Extraemos los datos exactos que manda el código de NestJS
        const encuestasServidor = structChanges.local_encuesta?.created || [];
        const seccionesServidor = structChanges.local_seccion?.created || [];
        const preguntasServidor = structChanges.local_estructura_pregunta?.created || [];

        // 2. Mapeo Defensivo y Reconstrucción
        const mergedChanges = {
          ...coreChanges,
          ...catChanges,

          local_encuesta: {
            created: encuestasServidor.map((row: any) => ({
              id: row.id?.toString(),
              nombre: row.nombre || 'Sin nombre',
              version_activa: row.version_activa || 1,
              estado: 1,
              orden: row.orden || 1,
              fecha_modificacion: row.fecha_modificacion || new Date().toISOString()
            })),
            updated: [], deleted: []
          },

          local_seccion: {
            created: seccionesServidor.map((row: any) => ({
              id: row.id?.toString(),
              id_encuesta: row.id_encuesta?.toString(),
              nombre:  row.titulo || row.nombre || 'Sección',
              orden: row.orden || 1
            })),
            updated: [], deleted: []
          },

          local_estructura_pregunta: {
            created: preguntasServidor.map((row: any) => {
              // LA MAGIA: Si la pregunta no trae id_encuesta, lo buscamos en su sección
              const seccionPadre = seccionesServidor.find((s: any) => s.id?.toString() === row.id_seccion?.toString());
              const idEncuestaReal = row.id_encuesta?.toString() || seccionPadre?.id_encuesta?.toString();

              return {
                id: row.id?.toString(),
                id_seccion: row.id_seccion?.toString(),
                id_encuesta: idEncuestaReal, // Resuelve el problema de las pantallas en blanco
                // --- COLUMNAS DE INTELIGENCIA 
                id_matriz_padre: row.id_matriz_padre?.toString() || null,
                sintaxis_calculo: row.sintaxis_calculo || null,
                regla_visibilidad: row.regla_visibilidad || null,
                regla_validacion: row.regla_validacion || null,
                //-----------------------
                etiqueta: row.etiqueta || 'Sin etiqueta',
                tipo_dato: row.tipo_dato || 'TEXTO',
                opciones: row.opciones || null,
                es_editable: row.es_editable === 1 ? 1 : 0,
                es_visible_default: row.es_visible_default === 1 ? 1 : 0,
                es_obligatorio: row.es_obligatorio === 1 ? 1 : 0 || row.EsObligatorio === 1 ? 1 : 0,
                orden: row.orden || 1,
              };
            }),
            updated: [], deleted: []
          },

          cat_menu_appex: {
            created: getTableData(coreChanges, ['cat_menu_appex', 'Cat_Menu_AppEx']).created.map((row: any) => ({
              id: row.IdMenu?.toString() || row.id?.toString(),
              titulo: row.Titulo || row.titulo || row.Nombre || 'Sin Título',
              icono: row.Icono || row.icono || 'folder',
              orden: row.Orden || row.orden || 1,
              ruta_pantalla: row.RutaPantalla || row.ruta_pantalla || null,
              id_padre: row.IdPadre ?? row.id_padre ?? null,
            })),
            updated: [], deleted: []
          },
        };

        return {
          changes: mergedChanges,
          timestamp: Date.now()
        };
      },

      // =========================================================
      // PUSH: SUBIDA DE DATOS DESDE LA APP AL SERVIDOR (SQLite -> SQL)
      // =========================================================
      pushChanges: async ({ changes }) => {
        console.log('📤 [SYNC PUSH] Detectando cambios locales para enviar al servidor...');

        const capturasNuevas = (changes as any).local_captura?.created || [];

        if (capturasNuevas.length === 0) {
          console.log('✅ [SYNC PUSH] No hay capturas nuevas para enviar.');
          return;
        }

        console.log(`📦 [SYNC PUSH] Se encontraron ${capturasNuevas.length} respuestas. Preparando paquetes...`);

        // 1. Agrupamos las respuestas por UUID
        const encuestasAgrupadas: Record<string, any[]> = {};

        capturasNuevas.forEach((cap: any) => {
          const uuid = cap.uuid_instancia;
          if (!encuestasAgrupadas[uuid]) {
            encuestasAgrupadas[uuid] = [];
          }
          encuestasAgrupadas[uuid].push(cap);
        });

        // 2. Enviamos cada encuesta agrupada al backend
        for (const [uuid, respuestas] of Object.entries(encuestasAgrupadas)) {
          const idEncuesta = respuestas[0].id_encuesta;

          const payload = {
            idEncuesta: Number(idEncuesta),
            respuestas: respuestas.map(r => ({
              idPregunta: Number(r.id_pregunta),
              uuidInstancia: r.uuid_instancia,
              valor: r.valor
            }))
          };

          console.log(`🚀 [SYNC PUSH] Enviando Instancia UUID: ${uuid}...`);

          try {
            // Asegúrate de que la ruta coincida con tu NestJS
            const response = await apiClient.post('/surveys/submit', payload);
            console.log(`✅ [SYNC PUSH] Servidor respondió OK para UUID: ${uuid}`, response.data);

            // --- NUEVO: MARCAR COMO ENVIADO EN SQLITE ---
            await database.write(async () => {
              const capturaCollection = database.collections.get('local_captura');
              // Buscamos todos los registros (respuestas) que pertenecen a este UUID
              const registrosActualizar = await capturaCollection.query(Q.where('uuid_instancia', uuid)).fetch();

              // Preparamos la actualización masiva a estado_sincro = 1 (Enviado)
              const updates = registrosActualizar.map((registro: any) =>
                registro.prepareUpdate((rec: any) => {
                  rec.estado_sincro = 1;
                })
              );
              await database.batch(...updates);
            });
            console.log(`✅ [SYNC PUSH] UUID ${uuid} marcado como ENVIADO localmente.`);
            // ---------------------------------------------

            // Opcional: Marcar como enviado localmente en un futuro Sprint
          } catch (err: any) {
            console.error(`❌ [SYNC PUSH ERROR] Falló el envío del UUID: ${uuid}. Razón:`, err.response?.data || err.message);
            throw new Error(`Error sincronizando captura ${uuid}`);
          }
        }

        console.log('🎉 [SYNC PUSH] Todas las capturas enviadas exitosamente.');
      },
    });

    console.log("✅ Sincronización exitosa");
  } catch (error) {
    console.error("❌ Error crítico durante la sincronización:", error);
    throw error;
  }
};