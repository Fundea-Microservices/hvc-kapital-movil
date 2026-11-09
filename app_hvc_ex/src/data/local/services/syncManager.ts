import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from '../database';
import { apiClient, apiClientCatalogos, registrarFalloHttp } from '../../../core/network/apiClient';
import { Database, Q } from '@nozbe/watermelondb';
import { useAuthStore } from '../../../presentation/store/useAuthStore';
import MetadataSync from '../models/MetadataSync';
import LocalCaptura from '../models/LocalCaptura';
import LocalClientePendiente from '../models/LocalClientePendiente';
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
import { estamparIdCaptura, contarPendientesDeSubida } from './multimedia.service';
import { subirMultimediaPendiente } from '../../remote/services/multimediaUploader';
import { enviarBitacora } from '../../remote/services/bitacoraSender';
import { registrarError } from './bitacora.service';
import { sincronizarClientesAsignados, empujarRechazosPendientes } from './clientesAsignados.service';

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
  // `local_cliente_pendiente` NO entra aquí a propósito: su servicio (GET
  // /api/onesiteex/precarga) no acepta ningún parámetro de fecha, así que cada carga
  // es completa y no hay cursor que sellar
];

const mapearFilaMenu = (row: FilaServidor) => ({
  id: textoDe(row, 'IdMenu', 'id'),
  titulo: textoDe(row, 'Titulo', 'titulo', 'Nombre') ?? 'Sin Título',
  icono: textoDe(row, 'Icono', 'icono') ?? 'folder',
  orden: numeroDe(row, 1, 'Orden', 'orden'),
  ruta_pantalla: textoDe(row, 'RutaPantalla', 'ruta_pantalla'),
  id_padre: textoDe(row, 'IdPadre', 'id_padre'),
  id_permiso_requerido: textoDe(row, 'IdPermisoRequerido', 'idPermisoRequerido', 'id_permiso_requerido'),
});

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

const confirmarYSellarSincronizacion = async (tablas: string[] = TABLAS_AUDITADAS) => {
  for (const tabla of tablas) {
    try {
      const respuesta = await apiClient.post<unknown>('/sync/ack', { tablaNombre: tabla, exitoso: true });

      // Se sella con el reloj del SERVIDOR, que es la misma referencia contra la que se
      // filtran los deltas (`FechaModificacion > @0`).
      const cuerpo = respuesta.data;
      const marcaServidor = esFilaServidor(cuerpo) ? textoDe(cuerpo, 'timestampServidor') : null;
      const sello = marcaServidor ? new Date(marcaServidor) : new Date();
      const selloValido = Number.isNaN(sello.getTime()) ? new Date() : sello;

      await database.write(async () => {
        const coleccion = database.collections.get<MetadataSync>('metadata_sync');
        const existentes = await coleccion.query(Q.where('tabla_nombre', tabla)).fetch();
        if (existentes.length > 0) {
          await existentes[0].update((r: MetadataSync) => { r.fecha_ultima_sinc = selloValido; });
        } else {
          await coleccion.create((r: MetadataSync) => {
            r.tabla_nombre = tabla;
            r.fecha_ultima_sinc = selloValido;
          });
        }
      });
    } catch (e) {
      console.warn('[SYNC ACK] No se pudo confirmar la tabla; su fecha local no avanza. Tabla:', tabla, e);
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

        // GUID desde el API de auth: no se convierte a número (daría NaN).
        const userId = String(userIdRaw);
        const idEncuesta = respuestas[0].id_encuesta;

        let idPrecargaEnvio: string | null = null;
        try {
          const tarjeta = await database.collections
            .get<LocalClientePendiente>('local_cliente_pendiente')
            .query(Q.where('id_cliente', uuidBase))
            .fetch();
          if (tarjeta.length > 0 && tarjeta[0].origen === 'PRECARGA') {
            idPrecargaEnvio = uuidBase;
          }
          // DIAGNÓSTICO TEMPORAL: confirma en Metro/logcat por qué idPrecarga sale null.
          // Retirar cuando FINALIZADO quede verificado en un cliente precargado real.
          console.warn(
            '[DIAG idPrecarga] uuidBase=%s tarjetas=%s origen=%s -> envio=%s',
            uuidBase,
            tarjeta.length,
            tarjeta[0]?.origen ?? '(sin fila)',
            idPrecargaEnvio ?? 'null',
          );
        } catch (e) {
          // Un fallo aquí no puede impedir el envío de la captura, que es lo
          // irrecuperable; como mucho se pierde la marca de FINALIZADO en el servidor.
          console.warn('[SYNC] No se pudo resolver idPrecarga de', uuidBase, e);
        }

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
          // GUID de pre.Precarga, o null para capturas ad-hoc.
          idPrecarga: idPrecargaEnvio,
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
            'x-user-id': userId,
            'user-id': userId,
            'idusuario': userId,
            'IdUsuario': userId,
            'X-User-Id': userId,
          }
        };

        try {
          const respuestaSubmit = await apiClient.post('/surveys/submit', payload, config);
          const datosSubmit = (respuestaSubmit?.data ?? {}) as FilaServidor;
          const idCapturaServidor = textoDe(datosSubmit, 'idCaptura', 'IdCaptura');

          if (idCapturaServidor) {
            await estamparIdCaptura(uuidBase, idCapturaServidor);
          } else {
            const pendientes = await contarPendientesDeSubida();
            if (pendientes > 0) {
              console.error(
                `❌ [Multimedia] El /submit de ${uuidBase} no devolvió idCaptura y hay ` +
                `${pendientes} archivo(s) pendientes. No podrán subirse hasta que el ` +
                'backend se actualice al Sprint 10.',
              );
            }
          }

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
          const mensajeBackend = axios.isAxiosError(err)
            ? (textoDe((err.response?.data ?? {}) as FilaServidor, 'message') ?? err.message)
            : err instanceof Error ? err.message : String(err);
          console.error('❌ [SYNC PUSH ERROR] Fallo al subir UUID:', uuidBase, 'Detalle:', mensajeBackend);
          await registrarError('syncManager.submit', err, { uuidBase, idEncuesta: String(idEncuesta) });
        }
      }
    }

    // =======================================================================
    // FASE 1.B: SUBIDA DE ARCHIVOS ADJUNTOS
    // =======================================================================
    try {
      await subirMultimediaPendiente();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      console.error(`❌ [Multimedia] La fase de subida falló por completo: ${detalle}`);
      await registrarError('syncManager.FASE1B', error);
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

          local_encuesta: {
            created: encuestasServidor.map((row) => ({
              id: textoDe(row, 'id'),
              nombre: textoDe(row, 'nombre') ?? 'Sin nombre',
              version_activa: numeroDe(row, 1, 'version_activa'),
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
                mensaje_error: textoDe(row, 'mensaje_error', 'mensajeError', 'MensajeError'),
                mensaje_notificacion: textoDe(row, 'mensaje_notificacion', 'mensajeNotificacion', 'MensajeNotificacion'),
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
          cat_menu_appex: (() => {
            const cambios = obtenerCambiosTabla(coreChanges, 'cat_menu_appex', 'Cat_Menu_AppEx');
            return {
              created: cambios.created.map(mapearFilaMenu),
              updated: cambios.updated.map(mapearFilaMenu),
              deleted: cambios.deleted,
            };
          })(),
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
      await sincronizarCatalogosApi(database);
    }
    await empujarRechazosPendientes(database);

    // ========================================================================
    // 4. CONFIRMACIÓN (ACK) Y SELLADO DE FECHAS POR TABLA — Regla 5.5
    // ========================================================================
    await confirmarYSellarSincronizacion();

    // ========================================================================
    // 5. ENVÍO DE LA BITÁCORA DE ERRORES
    // ========================================================================
    try {
      await enviarBitacora();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ [Bitácora] Fase de envío omitida: ${detalle}`);
    }

  } catch (error) {
    console.error('❌ [SYNC] Ciclo abortado. Detalle de la petición que lo causó:');
    registrarFalloHttp('SYNC', error);
    // Se registra ANTES de relanzar: este es el error que el asesor ve como "no se
    // pudo sincronizar" y del que hoy no queda ningún rastro consultable.
    await registrarError('syncManager.runFullSync', error);
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

    while (keepFetching) {
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
        allCatalogosRemotos = [...allCatalogosRemotos, ...catalogosRemotos];

        // Si la página actual devolvió menos registros que el límite, se asume que es la última
        if (catalogosRemotos.length < limit) {
          keepFetching = false;
        } else {
          page++;
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
      const existentes = await catalogoCollection.query().fetch();
      const registrosBorrados = existentes
        .filter((r) => !(r.nombreCatalogo || '').startsWith('API_'))
        .map((r) => r.prepareDestroyPermanently());

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
export const sincronizarCatalogosApi = async (databaseInstance: Database): Promise<void> => {
  try {
    const respuesta = await apiClient.get<unknown>('/surveys/catalogos-api');
    const cuerpo = respuesta.data;
    const datos = esFilaServidor(cuerpo) ? cuerpo.data : null;
    const opciones: FilaServidor[] = Array.isArray(datos) ? datos.filter(esFilaServidor) : [];

    if (opciones.length === 0) return; // Nada que precargar; no es un error.

    const catalogoCollection = databaseInstance.collections.get<CatalogoOpcion>('local_catalogo_opciones');

    await databaseInstance.write(async () => {
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