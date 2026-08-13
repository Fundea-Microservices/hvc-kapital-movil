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
import { estamparIdCaptura, contarPendientesDeSubida } from './multimedia.service';
import { subirMultimediaPendiente } from '../../remote/services/multimediaUploader';
import { enviarBitacora } from '../../remote/services/bitacoraSender';
import { registrarError } from './bitacora.service';

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

/**
 * Mapea una fila de menú del servidor al registro local. Se usa para `created` y para
 * `updated`: el backend clasifica en uno u otro según sea primera carga o incremental,
 * pero la forma de la fila es idéntica, así que el mapeo debe ser el mismo.
 */
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

/**
 * Confirma al servidor cada tabla sincronizada (POST /sync/ack → Log_Sincronizacion_AppEx)
 * y SOLO si el ACK es exitoso avanza la fecha local en metadata_sync (Regla 5.5).
 * Si un ACK falla, la fecha no avanza y el próximo sync re-pide esos deltas (upsert inocuo).
 */
const confirmarYSellarSincronizacion = async () => {
  for (const tabla of TABLAS_AUDITADAS) {
    try {
      const respuesta = await apiClient.post<unknown>('/sync/ack', { tablaNombre: tabla, exitoso: true });

      // Se sella con el reloj del SERVIDOR, que es la misma referencia contra la que se
      // filtran los deltas (`FechaModificacion > @0`). Con el reloj del dispositivo, un
      // móvil adelantado sellaba una fecha futura y dejaba fuera del filtro registros
      // que sí habían cambiado: se ocultaban de forma permanente, sin ningún error.
      // Si el servidor no devuelve la marca (versión anterior del backend), se cae al
      // reloj local para no bloquear la sincronización.
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
          const respuestaSubmit = await apiClient.post('/surveys/submit', payload, config);

          /**
           * El `IdCaptura` que devuelve el servidor es lo único que permite subir
           * después los archivos adjuntos: es un IDENTITY que genera SQL Server en
           * este INSERT, así que el dispositivo no puede conocerlo cuando toma la
           * foto —potencialmente días antes, sin señal—.
           *
           * Se lee como STRING. Es un BIGINT: convertirlo a número podría superar
           * Number.MAX_SAFE_INTEGER y redondearse SIN ERROR, subiendo el archivo a
           * la captura equivocada.
           *
           * Si el servidor no lo devuelve (backend anterior al Sprint 10) se registra
           * un error explícito y las filas quedan SIN id: invisibles para la cola.
           * NUNCA se inventa un valor — un id de reserva ocultaría el problema en vez
           * de mostrarlo, y los archivos acabarían colgados de una captura ajena.
           */
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
          // Axios no garantiza la forma del error: se inspecciona defensivamente.
          const mensajeBackend = axios.isAxiosError(err)
            ? (textoDe((err.response?.data ?? {}) as FilaServidor, 'message') ?? err.message)
            : err instanceof Error ? err.message : String(err);
          console.error(`❌ [SYNC PUSH ERROR] Fallo al subir UUID ${uuidBase}. Detalle:`, mensajeBackend);
          // Queda en la bitacora para que soporte pueda verlo sin el dispositivo
          // delante. El uuid identifica la instancia, no al encuestado.
          await registrarError('syncManager.submit', err, { uuidBase, idEncuesta: String(idEncuesta) });
          // Omitimos lanzar el throw para que intente subir las demás encuestas agrupadas si hay varias
        }
      }
    }

    // =======================================================================
    // FASE 1.B: SUBIDA DE ARCHIVOS ADJUNTOS
    // =======================================================================
    // Va aquí y no en otro sitio por tres razones:
    //  - DESPUÉS del submit, que es quien entrega el IdCaptura recién estampado.
    //  - ANTES del pull, para que un pull largo no retrase la evidencia de campo.
    //  - DENTRO del candado `isSyncRunning`, así dos ciclos solapados no suben el
    //    mismo archivo dos veces.
    // Recoge también archivos de envíos anteriores cuyo binario falló: un ciclo malo
    // no condena la evidencia. Nunca lanza — que falle una foto no debe impedir la
    // descarga de estructuras, que es lo que mantiene operativa la aplicación.
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
          // El spread de `coreChanges` aporta las tablas que el backend emite ya con la
          // forma nativa de WatermelonDB (p. ej. cat_parametros_appex). Las que se
          // declaran explícitamente más abajo lo sobrescriben, porque necesitan mapeo.
          ...(esFilaServidor(coreChanges) ? coreChanges : {}),

          // NO se hace spread de `catChanges`: /surveys/catalogs emite la tabla
          // `local_catalogos`, que es vestigial y NO la que lee el motor de formularios
          // (esa es `local_catalogo_opciones`, poblada por sincronizarCatalogos). Lo
          // único que producía era un warning de "tabla desconocida" en cada sync.

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

          // El menú debe aplicar los TRES grupos. Antes solo se leía `created` y se
          // forzaban `updated`/`deleted` vacíos, con lo que ningún cambio del BackOffice
          // llegaba nunca: el backend manda `created` SOLO en la primera carga y, en
          // cuanto metadata_sync tiene fecha, todo viaja por `updated`/`deleted`.
          // (Mientras metadata_sync no avanzaba, esto pasaba desapercibido porque el
          // backend repetía la primera carga en cada sincronización.)
          // Nota: este bloque va DESPUÉS del spread `...coreChanges`, así que lo
          // sobrescribe por completo — de ahí que haya que mapear todo aquí.
          cat_menu_appex: (() => {
            const cambios = obtenerCambiosTabla(coreChanges, 'cat_menu_appex', 'Cat_Menu_AppEx');
            return {
              created: cambios.created.map(mapearFilaMenu),
              updated: cambios.updated.map(mapearFilaMenu),
              // Ya viene normalizado a string[] por obtenerCambiosTabla, que es
              // exactamente lo que WatermelonDB espera (compara contra raw.id).
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
      // Catálogos de OrigenDatosTipo='API' (ej. Departamento/Municipio), resueltos
      // por el backend (proxy) y precargados aquí para que funcionen sin señal en
      // campo. Falla aislada: un problema con la API externa no debe abortar el sync.
      await sincronizarCatalogosApi(database);
    }

    // ========================================================================
    // 4. CONFIRMACIÓN (ACK) Y SELLADO DE FECHAS POR TABLA — Regla 5.5
    // ========================================================================
    await confirmarYSellarSincronizacion();

    // ========================================================================
    // 5. ENVÍO DE LA BITÁCORA DE ERRORES
    // ========================================================================
    // Va al FINAL a propósito: el diagnóstico es lo menos importante del ciclo. Si
    // algo falla aquí, lo que no puede pasar es que arrastre consigo la descarga de
    // estructuras ni el envío de capturas, que es el trabajo real del asesor.
    // `enviarBitacora` nunca lanza; el try/catch es una segunda barrera.
    try {
      await enviarBitacora();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ [Bitácora] Fase de envío omitida: ${detalle}`);
    }

  } catch (error) {
    console.error("❌ Error crítico durante la sincronización:", error);
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
      // El sistema purga los registros obsoletos anteriores para evitar duplicados residuales.
      // IMPORTANTE: se excluyen las filas de origen API (prefijo "API_"), que son
      // propiedad exclusiva de sincronizarCatalogosApi(). Cada función es dueña de
      // un subconjunto disjunto, así que el orden en que se invoquen deja de importar;
      // antes, una llamada tardía a esta función borraba los catálogos de API ya
      // descargados y los selects de Departamento/Municipio quedaban vacíos.
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