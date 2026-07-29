import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { apiClient, apiClientCatalogos } from '../../../core/network/apiClient';
import { Database, Q } from '@nozbe/watermelondb';
import { useAuthStore } from '../../../presentation/store/useAuthStore';
import MetadataSync from '../models/MetadataSync';
import LocalCaptura from '../models/LocalCaptura';
import { CatalogoOpcion } from '../models/CatalogoOpcion';
import { obtenerParametroNumerico } from './parametros.service';
import { leerRaw, type RawMetadataSync, type RawCaptura } from '../types/raw.types';
import {
  esFilaServidor,
  obtenerCambiosTabla,
  textoDe,
  numeroDe,
  banderaDe,
  type FilaServidor,
} from '../../remote/types/sync.types';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';

// ============================================================================
// 1. FUNCIÓN PRINCIPAL DE SINCRONIZACIÓN DE ENCUESTAS (Deltas)
// ============================================================================
let isSyncRunning = false;

// Tablas cuyo ciclo de sincronización se audita contra el servidor (Regla 5.5):
// la fecha local por tabla solo avanza cuando el ACK es confirmado.
const TABLAS_AUDITADAS = [
  'cat_menu_appex',
  'cat_parametros_appex',
  'local_estructura_pregunta',
  'local_catalogo_opciones',
];

/** Lee de metadata_sync la última fecha confirmada por tabla (ISO) para enviar deltas reales. */
const leerFechasSyncPorTabla = async (): Promise<Record<string, string | null>> => {
  const mapa: Record<string, string | null> = {};
  try {
    const rows = await database.collections.get<MetadataSync>('metadata_sync').query().fetch();
    rows.forEach((r) => {
      const raw = leerRaw<RawMetadataSync>(r);
      if (raw.tabla_nombre && raw.fecha_ultima_sinc) {
        mapa[raw.tabla_nombre] = new Date(raw.fecha_ultima_sinc).toISOString();
      }
    });
  } catch (e) {
    console.warn('[SYNC] No se pudieron leer fechas por tabla de metadata_sync:', e);
  }
  return mapa;
};

/**
 * Confirma al servidor cada tabla sincronizada (POST /sync/ack → Log_Sincronizacion_AppEx)
 * y SOLO si el ACK es exitoso avanza la fecha local en metadata_sync (Regla 5.5).
 * Si un ACK falla, la fecha no avanza y el próximo sync re-pide esos deltas (upsert inocuo).
 */
const confirmarYSellarSincronizacion = async () => {
  const ahora = new Date();
  for (const tabla of TABLAS_AUDITADAS) {
    try {
      await apiClient.post('/sync/ack', { tablaNombre: tabla, exitoso: true });

      await database.write(async () => {
        const coleccion = database.collections.get<MetadataSync>('metadata_sync');
        const existentes = await coleccion.query(Q.where('tabla_nombre', tabla)).fetch();
        if (existentes.length > 0) {
          await existentes[0].update((r: MetadataSync) => { r.fecha_ultima_sinc = ahora; });
        } else {
          await coleccion.create((r: MetadataSync) => {
            r.tabla_nombre = tabla;
            r.fecha_ultima_sinc = ahora;
          });
        }
      });
    } catch (e) {
      console.warn(`[SYNC ACK] No se pudo confirmar "${tabla}"; su fecha local no avanza:`, e);
    }
  }
};

export const runFullSync = async () => {
  if (isSyncRunning) {
    return;
  }
  isSyncRunning = true; // Cerramos el candado


  try {
    // =======================================================================
    // FASE 1: SUBIDA MANUAL DE ENCUESTAS (TOTALMENTE FUERA DEL PUSH NATIVO)
    // =======================================================================
    const capturaCollection = database.collections.get<LocalCaptura>('local_captura');

    // Buscamos SOLO las que están pendientes (estado_sincro = 0)
    const capturasPendientes = await capturaCollection.query(Q.where('estado_sincro', 0)).fetch();

    if (capturasPendientes.length > 0) {
      const encuestasAgrupadas: Record<string, LocalCaptura[]> = {};

      capturasPendientes.forEach((cap) => {
        // Obtenemos solo el UUID Base para agrupar TODA la encuesta
        const uuidCompleto = cap.uuid_instancia || '';
        const uuidBase = uuidCompleto.split('_')[0];

        if (!encuestasAgrupadas[uuidBase]) encuestasAgrupadas[uuidBase] = [];
        encuestasAgrupadas[uuidBase].push(cap);
      });

      for (const [uuidBase, respuestas] of Object.entries(encuestasAgrupadas)) {
        const userIdRaw = useAuthStore.getState().userId;

        if (!userIdRaw) {
          console.error("❌ CRÍTICO: No se encontró el ID del usuario en el estado global.");
          throw new Error(`Falta el ID del usuario logueado en Zustand.`);
        }

        const userId = Number(userIdRaw);
        const idEncuesta = respuestas[0].id_encuesta;

        // DEFENSIVO GEOLOCALIZACIÓN
        const registroGps = respuestas.find(r => {
          if (!r.valor || typeof r.valor !== 'string') return false;
          const partes = r.valor.split(',');
          if (partes.length !== 2) return false;
          return !isNaN(parseFloat(partes[0])) && !isNaN(parseFloat(partes[1]));
        });

        let latitudEnvio = null;
        let longitudEnvio = null;

        if (registroGps && registroGps.valor) {
          const partesGps = registroGps.valor.split(',');
          if (partesGps.length === 2) {
            latitudEnvio = parseFloat(partesGps[0].trim());
            longitudEnvio = parseFloat(partesGps[1].trim());
          }
        }

        // C. Corrección del Túnel de Sincronización: Se extraen los valores de telemetría reales persistidos en SQLite
        // en lugar de inyectar marcas de tiempo del momento del envío.
        // Programación defensiva: fallback a la hora actual en caso de valores nulos.
        const fechaInicioReal = respuestas.find(r => r.fecha_inicio)?.fecha_inicio;
        const fechaFinReal = respuestas.find(r => r.fecha_fin)?.fecha_fin;

        const payload = {
          idEncuesta: Number(idEncuesta),
          IdUsuario: userId,
          idUsuario: userId,
          latitud: latitudEnvio,
          longitud: longitudEnvio,
          fechaInicio: fechaInicioReal || new Date().toISOString(),
          fechaFin: fechaFinReal || new Date().toISOString(),
          // Identificador real del móvil para auditoría (Ticket 1: DispositivoID).
          dispositivoId: (await SecureStore.getItemAsync('deviceToken')) || 'ONE_SITE_SGRAS',
          respuestas: respuestas.map(r => ({
            idPregunta: Number(r.id_pregunta),
            uuidInstancia: r.uuid_instancia,
            valor: r.valor
          }))
        };

        const config = {
          headers: {
            'x-user-id': userId.toString(),
            'user-id': userId.toString(),
            'idusuario': userId.toString(),
            'IdUsuario': userId.toString(),
            'X-User-Id': userId.toString(),
          }
        };

        try {
          await apiClient.post('/surveys/submit', payload, config);

          // AHORA SÍ: Como estamos fuera del synchronize, WatermelonDB permite escribir sin problemas
          await database.write(async () => {
            const registrosActualizar = await capturaCollection.query(
              Q.where('uuid_instancia', Q.like(`${uuidBase}%`)),
              Q.where('estado_sincro', 0)
            ).fetch();

            const updates = registrosActualizar.map((registro) =>
              registro.prepareUpdate((rec: LocalCaptura) => {
                rec.estado_sincro = 1; // Marcado definitivo
              })
            );
            await database.batch(...updates);
          });
        } catch (err: unknown) {
          // Axios no garantiza la forma del error: se inspecciona defensivamente.
          const mensajeBackend = axios.isAxiosError(err)
            ? (textoDe((err.response?.data ?? {}) as FilaServidor, 'message') ?? err.message)
            : err instanceof Error ? err.message : String(err);
          console.error(`❌ [SYNC PUSH ERROR] Fallo al subir UUID ${uuidBase}. Detalle:`, mensajeBackend);
          // Omitimos lanzar el throw para que intente subir las demás encuestas agrupadas si hay varias
        }
      }
    }

    // =======================================================================
    // FASE 2: DESCARGA DE ESTRUCTURAS (PULL NATIVO DE WATERMELONDB)
    // =======================================================================
    await synchronize({
      database,
      pullChanges: async ({ lastPulledAt }) => {
        const syncDate = lastPulledAt ? new Date(lastPulledAt).toISOString() : null;
        // Fechas REALES por tabla (última sincronización confirmada con ACK).
        // Fallback a la fecha global de WatermelonDB para instalaciones previas.
        const fechasPorTabla = await leerFechasSyncPorTabla();

        const [coreRes, structureRes, catalogsRes] = await Promise.all([
          apiClient.post('/sync/deltas', {
            lastSyncDates: {
              cat_menu_appex: fechasPorTabla['cat_menu_appex'] ?? syncDate,
              cat_parametros_appex: fechasPorTabla['cat_parametros_appex'] ?? syncDate,
            }
          }),
          apiClient.post('/surveys/structure', { lastSyncDate: fechasPorTabla['local_estructura_pregunta'] ?? syncDate }),
          apiClient.post('/surveys/catalogs', { lastSyncDate: syncDate })
        ]);

        // Las respuestas HTTP son impredecibles: se tratan como `unknown` y se
        // normalizan con los lectores defensivos de sync.types.
        const structChanges: unknown = structureRes.data?.changes ?? {};
        const coreChanges: unknown = coreRes.data?.changes ?? {};
        const catChanges: unknown = catalogsRes.data?.changes ?? {};

        const encuestasServidor = obtenerCambiosTabla(structChanges, 'local_encuesta').created;
        const seccionesServidor = obtenerCambiosTabla(structChanges, 'local_seccion').created;
        const preguntasServidor = obtenerCambiosTabla(structChanges, 'local_estructura_pregunta').created;

        const mergedChanges = {
          ...(esFilaServidor(coreChanges) ? coreChanges : {}),
          ...(esFilaServidor(catChanges) ? catChanges : {}),

          local_encuesta: {
            created: encuestasServidor.map((row) => ({
              id: textoDe(row, 'id'),
              nombre: textoDe(row, 'nombre') ?? 'Sin nombre',
              version_activa: numeroDe(row, 1, 'version_activa'),
              estado: 1,
              orden: numeroDe(row, 1, 'orden'),
              fecha_modificacion: textoDe(row, 'fecha_modificacion') ?? new Date().toISOString()
            })),
            updated: [], deleted: []
          },

          local_seccion: {
            created: seccionesServidor.map((row) => ({
              id: textoDe(row, 'id'),
              id_encuesta: textoDe(row, 'id_encuesta'),
              titulo: textoDe(row, 'titulo', 'nombre') ?? 'Sección',
              orden: numeroDe(row, 1, 'orden')
            })),
            updated: [], deleted: []
          },

          local_estructura_pregunta: {
            created: preguntasServidor.map((row) => {
              const idSeccion = textoDe(row, 'id_seccion');
              const seccionPadre = seccionesServidor.find(s => textoDe(s, 'id') === idSeccion);
              const idEncuestaReal = textoDe(row, 'id_encuesta')
                ?? (seccionPadre ? textoDe(seccionPadre, 'id_encuesta') : null);

              // Cada campo acepta las tres cajas que emite el BackOffice.
              return {
                id: textoDe(row, 'id'),
                id_seccion: idSeccion,
                id_encuesta: idEncuestaReal,
                id_matriz_padre: textoDe(row, 'id_matriz_padre', 'idMatrizPadre', 'IdMatrizPadre'),
                sintaxis_calculo: textoDe(row, 'sintaxis_calculo', 'sintaxisCalculo', 'SintaxisCalculo'),
                regla_visibilidad: textoDe(row, 'regla_visibilidad', 'reglaVisibilidad', 'ReglaVisibilidad'),
                regla_validacion: textoDe(row, 'regla_validacion', 'reglaValidacion', 'ReglaValidacion'),
                etiqueta: textoDe(row, 'etiqueta', 'Etiqueta') ?? 'Sin etiqueta',
                tipo_dato: textoDe(row, 'tipo_dato', 'tipoDato', 'TipoDato') ?? 'TEXTO',
                opciones: textoDe(row, 'opciones', 'Opciones'),
                origen_datos_tipo: textoDe(row, 'origen_datos_tipo', 'origenDatosTipo', 'OrigenDatosTipo'),
                origen_datos_cmd: textoDe(row, 'origen_datos_cmd', 'origenDatosCmd', 'OrigenDatosCmd'),
                es_editable: banderaDe(row, 'es_editable', 'esEditable', 'EsEditable'),
                es_visible_default: banderaDe(row, 'es_visible_default', 'esVisibleDefault', 'EsVisibleDefault'),
                es_obligatorio: banderaDe(row, 'es_obligatorio', 'esObligatorio', 'EsObligatorio'),
                orden: numeroDe(row, 1, 'orden', 'Orden'),
              };
            }),
            updated: [], deleted: []
          },

          cat_menu_appex: {
            created: obtenerCambiosTabla(coreChanges, 'cat_menu_appex', 'Cat_Menu_AppEx').created.map((row) => ({
              id: textoDe(row, 'IdMenu', 'id'),
              titulo: textoDe(row, 'Titulo', 'titulo', 'Nombre') ?? 'Sin Título',
              icono: textoDe(row, 'Icono', 'icono') ?? 'folder',
              orden: numeroDe(row, 1, 'Orden', 'orden'),
              ruta_pantalla: textoDe(row, 'RutaPantalla', 'ruta_pantalla'),
              id_padre: textoDe(row, 'IdPadre', 'id_padre'),
              id_permiso_requerido: textoDe(row, 'IdPermisoRequerido', 'idPermisoRequerido', 'id_permiso_requerido'),
            })),
            updated: [], deleted: []
          },
        };

        return {
          changes: mergedChanges,
          timestamp: Date.now()
        };
      },

      // FIX CLAVE: Se deja el pushChanges nativo VACÍO para evitar colisiones
      pushChanges: async () => {
        // Ya hicimos el push manual en la Fase 1. Dejamos esto vacío para no bloquear WatermelonDB.
      },
    });

    // ========================================================================
    // 3. DESCARGA AUTOMÁTICA DE CATÁLOGOS
    // ========================================================================
    const token = useAuthStore.getState().token;
    if (token) {
      await sincronizarCatalogos(database, token);
      // Catálogos de OrigenDatosTipo='API' (ej. Departamento/Municipio), resueltos
      // por el backend (proxy) y precargados aquí para que funcionen sin señal en
      // campo. Falla aislada: un problema con la API externa no debe abortar el sync.
      await sincronizarCatalogosApi(database);
    }

    // ========================================================================
    // 4. CONFIRMACIÓN (ACK) Y SELLADO DE FECHAS POR TABLA — Regla 5.5
    // ========================================================================
    await confirmarYSellarSincronizacion();

  } catch (error) {
    console.error("❌ Error crítico durante la sincronización:", error);
    throw error;
  }
  finally {
    isSyncRunning = false;
  }
};

// ============================================================================
// 2. FUNCIÓN DE DESCARGA MASIVA DE CATÁLOGOS (API Estricta con Paginación)
// ============================================================================
export const sincronizarCatalogos = async (databaseInstance: Database, token: string) => {
  // endpoint esperado: process.env.EXPO_PUBLIC_API_URL + '/catalogo-opcion/maestros'
  try {
    // Parametrizable desde el BackOffice (Cat_Parametros_AppEx) sin publicar nueva versión.
    const limit = await obtenerParametroNumerico('SYNC_CATALOGOS_LIMIT', 250);
    let page = 1;
    let keepFetching = true;
    let allCatalogosRemotos: FilaServidor[] = [];

    // El sistema ejecuta un ciclo iterativo para consumir todas las páginas disponibles
    while (keepFetching) {
      // Se utiliza el cliente global configurado de Axios omitiendo URLs expuestas
      const response = await apiClientCatalogos.get<unknown>(`/catalogo-opcion/maestros?page=${page}&limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // La respuesta llega sin tipar: se valida su forma antes de acumularla.
      const cuerpo = response.data;
      const datos = esFilaServidor(cuerpo) ? cuerpo.data : null;
      const catalogosRemotos: FilaServidor[] = Array.isArray(datos) ? datos.filter(esFilaServidor) : [];

      // Validación de ruptura: si no hay más registros, se detiene el ciclo
      if (catalogosRemotos.length === 0) {
        keepFetching = false;
      } else {
        // Se acumulan los registros de forma secuencial en memoria temporal
        allCatalogosRemotos = [...allCatalogosRemotos, ...catalogosRemotos];

        // Si la página actual devolvió menos registros que el límite, se asume que es la última
        if (catalogosRemotos.length < limit) {
          keepFetching = false;
        } else {
          page++; // Incremento de puntero de página para la siguiente iteración
        }
      }
    }

    // Defensa técnica: si el acumulador final está vacío, se aborta la escritura local
    if (allCatalogosRemotos.length === 0) {
      console.warn("El servidor respondió con un conjunto de datos vacío para los catálogos.");
      return;
    }

    const catalogoCollection = databaseInstance.collections.get<CatalogoOpcion>('local_catalogo_opciones');

    // Se abre un bloque de escritura único para garantizar la atomicidad (Todo o Nada)
    await databaseInstance.write(async () => {
      // El sistema purga los registros obsoletos anteriores para evitar duplicados residuales
      const existentes = await catalogoCollection.query().fetch();
      const registrosBorrados = existentes.map((r) => r.prepareDestroyPermanently());

      // Mapeo estructurado de la carga útil hacia el esquema local de SQLite
      const nuevosRegistros = allCatalogosRemotos.map((cat) =>
        catalogoCollection.prepareCreate((record: CatalogoOpcion) => {
          record.idRemoto = textoDe(cat, 'id') ?? '';
          record.nombreCatalogo = textoDe(cat, 'nombre_catalogo') ?? '';
          record.codigoCatalogo = textoDe(cat, 'codigo_catalogo') ?? '';
          record.codigoOpcion = textoDe(cat, 'codigo_opcion') ?? '';
          record.valorOpcion = textoDe(cat, 'valor_opcion') ?? '';
          record.idPadreOpcion = textoDe(cat, 'id_padre_opcion');
        })
      );

      // Transacción en bloque de alta velocidad mediante el motor de WatermelonDB
      await databaseInstance.batch(registrosBorrados.concat(nuevosRegistros));
    });
  } catch (error) {
    console.error('❌ Error en el servicio de sincronización de catálogos:', error);
  }
};

// ============================================================================
// 3. CATÁLOGOS DESDE API EXTERNA (OrigenDatosTipo = 'API', ej. Departamento/Municipio)
// ============================================================================
/**
 * Descarga los catálogos que el BackOffice marcó con OrigenDatosTipo='API' (el
 * backend los resuelve como proxy, incluida la cascada padre-hijo vía {padre})
 * y los guarda en local_catalogo_opciones para que funcionen offline en campo.
 *
 * A diferencia de sincronizarCatalogos(), esta función SOLO reemplaza las filas
 * cuyo nombre_catalogo empieza con "API_" — no toca los catálogos maestros del
 * otro origen. Falla aislada (try/catch propio): si la API externa no responde,
 * el resto de la sincronización debe completarse igual.
 */
export const sincronizarCatalogosApi = async (databaseInstance: Database): Promise<void> => {
  try {
    const respuesta = await apiClient.get<unknown>('/surveys/catalogos-api');
    const cuerpo = respuesta.data;
    const datos = esFilaServidor(cuerpo) ? cuerpo.data : null;
    const opciones: FilaServidor[] = Array.isArray(datos) ? datos.filter(esFilaServidor) : [];

    if (opciones.length === 0) return; // Nada que precargar; no es un error.

    const catalogoCollection = databaseInstance.collections.get<CatalogoOpcion>('local_catalogo_opciones');

    await databaseInstance.write(async () => {
      // Solo se purgan las filas de origen API (prefijo "API_"), preservando los
      // catálogos maestros sincronizados por sincronizarCatalogos(). Se filtra en
      // JS (no con Q.like) para no depender de reglas de escape de SQL LIKE.
      const todos = await catalogoCollection.query().fetch();
      const existentesApi = todos.filter((r) => (r.nombreCatalogo || '').startsWith('API_'));
      const registrosBorrados = existentesApi.map((r) => r.prepareDestroyPermanently());

      const nuevosRegistros = opciones.map((op) =>
        catalogoCollection.prepareCreate((record: CatalogoOpcion) => {
          record.idRemoto = textoDe(op, 'id_remoto') ?? '';
          record.nombreCatalogo = textoDe(op, 'nombre_catalogo') ?? '';
          record.codigoCatalogo = textoDe(op, 'codigo_catalogo') ?? '';
          record.codigoOpcion = textoDe(op, 'codigo_opcion') ?? '';
          record.valorOpcion = textoDe(op, 'valor_opcion') ?? '';
          record.idPadreOpcion = textoDe(op, 'id_padre_opcion');
        })
      );

      await databaseInstance.batch(registrosBorrados.concat(nuevosRegistros));
    });
  } catch (error) {
    // No se relanza: un fallo de la API externa no debe abortar runFullSync.
    console.warn('[CATALOGOS-API] No se pudieron precargar los catálogos de API externa:', error);
  }
};