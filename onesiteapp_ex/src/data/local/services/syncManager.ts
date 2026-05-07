import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { apiClient } from '../../../core/network/apiClient';

export const runFullSync = async () => {
  try {
    await synchronize({
      database,
      pullChanges: async ({ lastPulledAt }) => {
        const syncDate = lastPulledAt ? new Date(lastPulledAt).toISOString() : null;


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
          return { created: [], updated: [], deleted: [] }; // Vacío si no encuentra nada
        };
        // Obtenemos los datos de las encuestas buscando por todas las variantes posibles
        const datosEncuesta = getTableData(structChanges, ['appEx_Encuesta', 'AppEx_Encuesta', 'Local_Encuesta', 'local_encuesta']);
        const datosSeccion = getTableData(structChanges, ['appEx_Seccion', 'AppEx_Seccion', 'Local_Seccion', 'local_seccion']);
        const datosPregunta = getTableData(structChanges, ['appEx_Pregunta', 'AppEx_Pregunta', 'Local_Estructura_Pregunta', 'local_estructura_pregunta']);

        // Función segura para mapear: si no hay datos, devuelve la estructura que Watermelon espera
        const safeMap = (tableObj: any, idKey: string) => ({
          created: (tableObj?.created || []).map((row: any) => ({ ...row, id: row[idKey]?.toString() })),
          updated: (tableObj?.updated || []).map((row: any) => ({ ...row, id: row[idKey]?.toString() })),
          deleted: tableObj?.deleted || []
        });
        // 1. Diccionario para vincular Preguntas con su Encuesta a través de la Sección
        const mapaSecciones: Record<string, string> = {};
        datosSeccion.created.forEach((sec: any) => {
          const idSec = sec.IdSeccion?.toString() || sec.id?.toString();
          const idEnc = sec.IdEncuesta?.toString() || sec.id_encuesta?.toString();
          if (idSec && idEnc) {
            mapaSecciones[idSec] = idEnc;
          }
        });

        // Extraemos los datos exactos que manda el nuevo código de NestJS
        const encuestasServidor = structureRes.data?.changes?.local_encuesta?.created || [];
        const seccionesServidor = structureRes.data?.changes?.local_seccion?.created || [];
        const preguntasServidor = structureRes.data?.changes?.local_estructura_pregunta?.created || [];

        // UNIFICAMOS NOMBRES: Servidor (PascalCase) -> Local (snake_case)
        const mergedChanges = {
          ...coreChanges,
          ...catChanges,
          // Mapeamos explícitamente cada tabla de estructura
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
              id_encuesta: row.id_encuesta?.toString(), // La sección SÍ trae la encuesta
              nombre: row.nombre || row.titulo || 'Sección',
              orden: row.orden || 1
            })),
            updated: [], deleted: []
          },
          //: Inyección del IdEncuesta
          local_estructura_pregunta: {
            created: preguntasServidor.map((row: any) => {
              // LA MAGIA: Si la pregunta no trae id_encuesta, lo buscamos en su sección
              const seccionPadre = seccionesServidor.find((s: any) => s.id?.toString() === row.id_seccion?.toString());
              const idEncuestaReal = row.id_encuesta?.toString() || seccionPadre?.id_encuesta?.toString();

              return {
                id: row.id?.toString(),
                id_seccion: row.id_seccion?.toString(),
                id_encuesta: idEncuestaReal, // ¡Ahora ya no será null!
                etiqueta: row.etiqueta || 'Sin etiqueta',
                tipo_dato: row.tipo_dato || 'TEXTO',
                opciones: row.opciones || null,
                es_editable: row.es_editable === 1 ? 1 : 0,
                es_visible_default: 1,
                es_obligatorio: row.es_obligatorio === 1 ? 1 : 0,
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
          timestamp: Date.now() // Usamos el tiempo actual si el servidor no lo envía claro
        };
      },
      pushChanges: async ({ changes }) => {
        // Implementación de push si es necesario
      },

    });
    console.log("✅ Sincronización exitosa");
  } catch (error) {
    console.error("❌ Error crítico durante la sincronización:", error);
    throw error;
  }

};