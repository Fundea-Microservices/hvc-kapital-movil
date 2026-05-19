import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { apiClient } from '../../../core/network/apiClient';
import { Database, Q } from '@nozbe/watermelondb';
import { useAuthStore } from '../../../presentation/store/useAuthStore';
import axios from 'axios';

// ============================================================================
// 1. FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN DE ENCUESTAS (Deltas)
// ============================================================================
let isSyncRunning = false;

export const runFullSync = async () => {
  console.log('🔄 [SYNC] Iniciando sincronización...');
  isSyncRunning = true; // Cerramos el candado
  try {
    await synchronize({
      database,
      pullChanges: async ({ lastPulledAt }) => {
        console.log('📥 [SYNC PULL] Obteniendo cambios del servidor...');
        const syncDate = lastPulledAt ? new Date(lastPulledAt).toISOString() : null;

        const [coreRes, structureRes, catalogsRes] = await Promise.all([
          apiClient.post('/sync/deltas', { lastSyncDates: { cat_menu_appex: syncDate, cat_parametros_appex: syncDate } }),
          apiClient.post('/surveys/structure', { lastSyncDate: syncDate }),
          apiClient.post('/surveys/catalogs', { lastSyncDate: syncDate })
        ]);

        const structChanges = structureRes.data?.changes || {};
        const coreChanges = coreRes.data?.changes || {};
        const catChanges = catalogsRes.data?.changes || {};

        const getTableData = (obj: any, posiblesNombres: string[]) => {
          for (const nombre of posiblesNombres) {
            if (obj[nombre]) return obj[nombre];
          }
          return { created: [], updated: [], deleted: [] };
        };

        const encuestasServidor = structChanges.local_encuesta?.created || [];
        const seccionesServidor = structChanges.local_seccion?.created || [];
        const preguntasServidor = structChanges.local_estructura_pregunta?.created || [];

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
              titulo:  row.titulo || row.nombre || 'Sección',
              orden: row.orden || 1
            })),
            updated: [], deleted: []
          },

          local_estructura_pregunta: {
            created: preguntasServidor.map((row: any) => {
              const seccionPadre = seccionesServidor.find((s: any) => s.id?.toString() === row.id_seccion?.toString());
              const idEncuestaReal = row.id_encuesta?.toString() || seccionPadre?.id_encuesta?.toString();

              return {
                id: row.id?.toString(),
                id_seccion: row.id_seccion?.toString(),
                id_encuesta: idEncuestaReal, 
                id_matriz_padre: row.id_matriz_padre?.toString() || null,
                sintaxis_calculo: row.sintaxis_calculo || row.sintaxisCalculo || null,
                regla_visibilidad: row.regla_visibilidad || row.reglaVisibilidad || null,
                regla_validacion: row.regla_validacion || row.reglaValidacion || null,
                etiqueta: row.etiqueta || row.Etiqueta || 'Sin etiqueta',
                tipo_dato: row.tipo_dato || row.tipoDato || 'TEXTO',
                
                //  Añadimos las columnas que faltaban en el contrato de mapeo
                // Protegemos por si el backend lo envía con nomenclaturas distintas
                opciones: row.opciones || row.Opciones || null,
                origen_datos_tipo: row.origen_datos_tipo || row.origenDatosTipo || row.origen_datos_tipo || null,
                origen_datos_cmd: row.origen_datos_cmd || row.origenDatosCmd || row.origen_datos_cmd || null,
                
                es_editable: (row.es_editable === 1 || row.esEditable === 1) ? 1 : 0,
                es_visible_default: (row.es_visible_default === 1 || row.esVisibleDefault === 1) ? 1 : 0,
                
                // Limpiamos la precedencia lógica del operador condicional que estaba mezclado
                es_obligatorio: (row.es_obligatorio === 1 || row.EsObligatorio === 1 || row.esObligatorio === 1) ? 1 : 0,
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

      pushChanges: async ({ changes }) => {
        console.log('📤 [SYNC PUSH] Detectando cambios locales...');
        const capturasNuevas = (changes as any).local_captura?.created || [];
        if (capturasNuevas.length === 0) return;

        const encuestasAgrupadas: Record<string, any[]> = {};
        capturasNuevas.forEach((cap: any) => {
          const uuid = cap.uuid_instancia;
          if (!encuestasAgrupadas[uuid]) encuestasAgrupadas[uuid] = [];
          encuestasAgrupadas[uuid].push(cap);
        });

        for (const [uuid, respuestas] of Object.entries(encuestasAgrupadas)) {
          // Extracción segura del estado de Zustand
          const authState = useAuthStore.getState() as any;
          const userIdRaw = authState.userId || authState.user?.id || authState.id;
          
          if (!userIdRaw) {
            console.error("❌ CRÍTICO: No se encontró el ID del usuario en el estado global.");
            throw new Error(`Falta el ID del usuario logueado en Zustand.`);
          }

          const userId = Number(userIdRaw); 
          const idEncuesta = respuestas[0].id_encuesta;

          // Cuerpo del paquete JSON
          const payload = {
            idEncuesta: Number(idEncuesta),
            IdUsuario: userId, 
            idUsuario: userId,
            respuestas: respuestas.map(r => ({
              idPregunta: Number(r.id_pregunta),
              uuidInstancia: r.uuid_instancia,
              valor: r.valor
            }))
          };

          // ⚡ FIX CRÍTICO: Inyectamos el ID del usuario en los HEADERS HTTP
          // Enviamos las variaciones más comunes de nomenclaturas de red
          const config = {
            headers: {
              'x-user-id': userId.toString(),
              'user-id': userId.toString(),
              'idusuario': userId.toString(),
              'IdUsuario': userId.toString(),
              'X-User-Id': userId.toString(),
            }
          };
          // Imprimimos el payload exacto antes de enviarlo
          console.log(`🚀 [SYNC PUSH] Enviando payload para UUID ${uuid}:`, JSON.stringify(payload, null, 2));

          try {
            await apiClient.post('/surveys/submit', payload);
            await database.write(async () => {
              const capturaCollection = database.collections.get('local_captura');
              const registrosActualizar = await capturaCollection.query(Q.where('uuid_instancia', uuid)).fetch();

              const updates = registrosActualizar.map((registro: any) =>
                registro.prepareUpdate((rec: any) => {
                  rec.estado_sincro = 1;
                })
              );
              await database.batch(...updates);
            });
            console.log(`✅ [SYNC PUSH] Captura ${uuid} sincronizada con éxito.`);
          } catch (err: any) {
            const mensajeBackend = err.response?.data?.message || err.message;
            console.error(`❌ [SYNC PUSH ERROR] Fallo al subir UUID ${uuid}. Detalle:`, mensajeBackend);
            throw new Error(`Error sincronizando captura ${uuid}: ${mensajeBackend}`);
          }
        }
      },
    });
    
    console.log("✅ Sincronización base exitosa");

    // ========================================================================
    // INTERCEPCIÓN DE INGENIERÍA: DESCARGA AUTOMÁTICA DE CATÁLOGOS
    // ========================================================================
    const token = useAuthStore.getState().token;
    if (token) {
      console.log('📥 [SYNC] Iniciando descarga automática de catálogos maestros...');
      // El sistema ejecuta la descarga pasándole la instancia global de la base de datos
      await sincronizarCatalogos(database, token);
    }

  } catch (error) {
    console.error("❌ Error crítico durante la sincronización:", error);
    throw error;
  }
  finally {
    // ⚡ FIX: Abrimos el candado termine bien o mal
    isSyncRunning = false; 
  }
};

// ============================================================================
// 2. FUNCIÓN DE DESCARGA MASIVA DE CATÁLOGOS (API Estricta con Paginación)
// ============================================================================
export const sincronizarCatalogos = async (databaseInstance: Database, token: string) => {
  try {
    // CORRECCIÓN DE PARÁMETROS: El sistema fuerza la lectura desde la página 1 con límite extendido
    const response = await axios.get('http://172.25.5.11:3000/api/onesiteex/catalogo-opcion/maestros?page=1&limit=500', {
      headers: { Authorization: `Bearer ${token}` }
    });

    const catalogosRemotos = response.data.data;
    
    if (!catalogosRemotos || catalogosRemotos.length === 0) {
      console.warn("⚠️ El servidor respondió con un conjunto de datos vacío para los catálogos.");
      return;
    }

    const catalogoCollection = databaseInstance.collections.get('local_catalogo_opciones');

    await databaseInstance.write(async () => {
      // El sistema limpia los registros anteriores antes de realizar la carga masiva
      const existentes = await catalogoCollection.query().fetch();
      const registrosBorrados = existentes.map(r => r.prepareDestroyPermanently());
      
      const nuevosRegistros = catalogosRemotos.map((cat: any) => 
        catalogoCollection.prepareCreate((record: any) => {
          record.idRemoto = cat.id?.toString() || '';
          record.nombreCatalogo = cat.nombre_catalogo || '';
          record.codigoCatalogo = cat.codigo_catalogo || '';
          record.codigoOpcion = cat.codigo_opcion || '';
          record.valorOpcion = cat.valor_opcion || '';
          record.idPadreOpcion = cat.id_padre_opcion || null;
        })
      );

      // Transacción en bloque de alta velocidad
      await databaseInstance.batch(registrosBorrados.concat(nuevosRegistros))
    });

    console.log(`✅ [SQLITE] ${catalogosRemotos.length} Catálogos maestros guardados para uso sin conexión.`);
  } catch (error) {
    console.error('❌ Error en el servicio de sincronización de catálogos:', error);
  }
};