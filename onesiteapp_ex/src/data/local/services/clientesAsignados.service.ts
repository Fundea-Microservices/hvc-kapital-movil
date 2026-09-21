import axios from 'axios';
import { Database, Q } from '@nozbe/watermelondb';
import { apiClient, apiClientAgenda, agendaConfigurada } from '../../../core/network/apiClient';
import LocalClientePendiente from '../models/LocalClientePendiente';
import LocalEstructuraPregunta from '../models/LocalEstructuraPregunta';
import MetadataSync from '../models/MetadataSync';
import * as SecureStore from 'expo-secure-store';
import { obtenerParametro, obtenerParametroNumerico } from './parametros.service';
import { registrarError } from './bitacora.service';
import { leerRaw, type RawPregunta } from '../types/raw.types';
import { esFilaServidor, numeroDe, textoDe, type FilaServidor } from '../../remote/types/sync.types';
import { esNombreMarcador } from '../../../domain/agenda/precarga';
import {
  aClienteAsignado,
  estaRevocado,
  ETIQUETAS_POR_DEFECTO,
  type ClienteAsignado,
  type EtiquetasTarjeta,
} from '../adapters/precargaAdapter';

/**
 * Descarga de la cartera de clientes que BackOffice asigna al asesor (RF-CE-07).
 *
 * POR QUÉ NO VA POR `pullChanges` DE `synchronize()`
 * El `pushChanges` del proyecto está definido pero vacío, así que en cada ciclo
 * `markLocalChangesAsSynced` limpia el `_changed` de todas las filas. La resolución de
 * conflictos de WatermelonDB —la que protegería las columnas modificadas en local— deja
 * de aplicar en la siguiente corrida y el servidor acabaría pisando `estado_gestion`.
 * Con un escritor explícito se controla columna por columna qué se toca y qué no.
 *
 * PROPIEDAD DISJUNTA
 * Esta función es dueña EXCLUSIVAMENTE de las filas con `origen = 'PRECARGA'`. Las
 * `'AD-HOC'` pertenecen a `persistirCapturas` y aquí no se leen ni se escriben. Es lo
 * que hace irrelevante el orden de invocación y evita el fallo que ya ocurrió con los
 * catálogos, donde una función borraba en silencio lo que la otra acababa de traer.
 *
 * NO HAY SINCRONIZACIÓN INCREMENTAL, Y ES DEL SERVICIO, NO UNA DECISIÓN NUESTRA
 * `GET /api/onesiteex/precarga` acepta `page`, `limit`, `idEncuesta`, `idEmpresa`,
 * `usuario` y `estado` — pero NINGÚN parámetro de fecha. No existe forma de pedir "lo
 * que cambió desde X", así que cada corrida trae la cartera COMPLETA de su ámbito.
 *
 * Consecuencias, todas deliberadas:
 *   · Esta tabla NO participa del cursor de `metadata_sync` ni del `/sync/ack`. Sellar
 *     una fecha que nadie usa para filtrar daría una falsa sensación de incrementalidad
 *     y, el día que el servicio la soportara, arrancaría desde una marca inventada.
 *   · Las BAJAS se deducen por AUSENCIA dentro del ámbito consultado: no hay `deleted[]`.
 *     Por eso el ámbito importa tanto — ver `OpcionesPrecarga.idEncuesta`.
 *   · Es idempotente: repetir la carga no duplica nada, porque se reconcilia por
 *     `id_cliente` contra lo ya guardado.
 */

/** Nombre de la tabla, y también la clave de su cursor en `metadata_sync`. */
export const TABLA_AGENDA = 'local_cliente_pendiente';

/** Clave de la marca informativa de la última recarga manual de una encuesta. */
export const claveUltimaCargaManual = (idEncuesta: string): string =>
  `${TABLA_AGENDA}_manual:${idEncuesta}`;

export type MotivoFalloPrecarga = 'SIN_CONFIGURAR' | 'SIN_RED' | 'ERROR' | 'OCUPADO';

/**
 * Candado de la cartera.
 *
 * La fase automática del sync y el botón "Cargar datos" escriben sobre las MISMAS
 * filas. El candado vive aquí —y no en la pantalla— porque una bandera leída durante
 * el render no vuelve a evaluarse cuando cambia: el botón se quedaría con el valor de
 * su último dibujado y dejaría pasar la pulsación igualmente. En el servicio la
 * comprobación ocurre en el instante de la escritura, que es cuando importa.
 */
let cargaEnCurso = false;

export interface ResultadoPrecarga {
  ok: boolean;
  /** Filas de cartera recibidas del servidor en este ciclo. */
  recibidos: number;
  motivo?: MotivoFalloPrecarga;
}

export interface OpcionesPrecarga {
  /**
   * Acota la operación a una encuesta; ausente = toda la cartera del asesor.
   *
   * Define también el ÁMBITO DE LAS BAJAS, y ahí está el riesgo: como las bajas se
   * deducen por ausencia, solo pueden buscarse entre las filas que el servidor tenía
   * la oportunidad de devolver. Al pedir la encuesta X, únicamente se purgan filas de
   * X; las de Y y Z ni se miran. Ampliar el purgado fuera del ámbito consultado
   * borraría cartera perfectamente vigente.
   */
  idEncuesta?: string;
}

/** Parámetro de consulta que acota la cartera al asesor de la sesión. */
interface FiltroAsesor {
  campo: string;
  valor: string;
}

/**
 * Filtro por asesor. Se lee de SecureStore y no del store de Zustand: es la fuente
 * autoritativa de la sesión en este proyecto (el store se rehidrata desde AsyncStorage
 * y puede ir por detrás en el arranque).
 *
 * SE USA `idEncuestador`, NO `usuario` — comprobado contra el servicio (2026-09-07):
 *   · `idEncuestador=3`   → 200 y solo las filas de ese asesor.
 *   · `idEncuestador=999` → 200 con lista vacía: degrada limpio.
 *   · `usuario=3`         → **404** «El usuario "3" no existe»; ese parámetro espera el
 *                            NOMBRE de usuario, y uno inexistente es un error duro, no
 *                            una lista vacía. Enviarle el id numérico era la causa del
 *                            404 que rompía la carga.
 * El tunable `AGENDA_CAMPO_USUARIO` conserva `nombre` como alternativa por si el
 * despliegue cambia de criterio, pero el valor por defecto (`id`) es el verificado.
 */
const leerFiltroAsesor = async (): Promise<FiltroAsesor | null> => {
  try {
    const campo = (await obtenerParametro('AGENDA_CAMPO_USUARIO', 'id')).trim().toLowerCase();
    const porNombre = campo === 'nombre';
    const valor = await SecureStore.getItemAsync(porNombre ? 'user_name' : 'user_id');
    if (!valor || valor.trim() === '') return null;
    return { campo: porNombre ? 'usuario' : 'idEncuestador', valor: valor.trim() };
  } catch (e) {
    console.warn('[AGENDA] No se pudo leer la identidad del asesor:', e);
    return null;
  }
};

/**
 * Etiquetas con las que se reconocen expediente y ubicación dentro de `valores`.
 *
 * Se pueden redefinir desde `cat_parametros_appex` sin publicar una versión nueva. Como
 * `obtenerParametro` siempre cae al valor del llamador, no definirlas deja exactamente
 * el comportamiento por defecto: añadir el tunable es seguro por construcción.
 */
const leerEtiquetas = async (): Promise<EtiquetasTarjeta> => {
  const separar = (crudo: string, porDefecto: readonly string[]): readonly string[] => {
    const partes = crudo.split(',').map((p) => p.trim()).filter((p) => p !== '');
    return partes.length > 0 ? partes : porDefecto;
  };
  const expediente = await obtenerParametro('AGENDA_ETIQUETAS_EXPEDIENTE', '');
  const ubicacion = await obtenerParametro('AGENDA_ETIQUETAS_UBICACION', '');
  const nombre = await obtenerParametro('AGENDA_ETIQUETAS_NOMBRE', '');
  const documento = await obtenerParametro('AGENDA_ETIQUETAS_DOCUMENTO', '');
  const cuenta = await obtenerParametro('AGENDA_ETIQUETAS_CUENTA', '');
  const operacion = await obtenerParametro('AGENDA_ETIQUETAS_OPERACION', '');
  return {
    expediente: separar(expediente, ETIQUETAS_POR_DEFECTO.expediente),
    ubicacion: separar(ubicacion, ETIQUETAS_POR_DEFECTO.ubicacion),
    nombre: separar(nombre, ETIQUETAS_POR_DEFECTO.nombre),
    documento: separar(documento, ETIQUETAS_POR_DEFECTO.documento),
    cuenta: separar(cuenta, ETIQUETAS_POR_DEFECTO.cuenta),
    operacion: separar(operacion, ETIQUETAS_POR_DEFECTO.operacion),
  };
};

/**
 * Catálogo local `id_pregunta` → `etiqueta`.
 *
 * El servicio manda `valores` SIN etiqueta (solo `id_pregunta`), así que el expediente
 * y la ubicación de la tarjeta se resuelven cruzando contra las preguntas que la app ya
 * tiene sincronizadas. Se construye una vez por corrida, no por fila.
 *
 * Un fallo aquí NO aborta la descarga: se devuelve un mapa vacío y la cartera se guarda
 * sin esos dos campos. Perder dos líneas de la tarjeta es mucho menos grave que
 * quedarse sin agenda.
 */
const leerEtiquetasPorPregunta = async (
  databaseInstance: Database,
): Promise<ReadonlyMap<string, string>> => {
  const mapa = new Map<string, string>();
  try {
    const preguntas = await databaseInstance.collections
      .get<LocalEstructuraPregunta>('local_estructura_pregunta')
      .query()
      .fetch();
    preguntas.forEach((p) => {
      const raw = leerRaw<RawPregunta>(p);
      const etiqueta = p.etiqueta ?? raw.etiqueta;
      if (etiqueta) mapa.set(String(p.id), String(etiqueta));
    });
  } catch (e) {
    console.warn('[AGENDA] No se pudieron leer las etiquetas de las preguntas:', e);
  }
  return mapa;
};

/**
 * Claves bajo las que distintas APIs cuelgan el arreglo de resultados.
 *
 * El servicio envuelve la respuesta (`{ statusCode, message, success, data }`), pero ni
 * el nombre de la clave ni su anidamiento están fijados por contrato escrito. Se
 * prueban varias en vez de codificar una: acertar la envoltura no debería requerir
 * publicar una versión de la app.
 */
const CLAVES_DATOS = ['data', 'datos', 'items', 'resultado', 'resultados', 'registros', 'rows', 'content', 'precargas'];

/**
 * Claves bajo las que viaja la metadata de paginación.
 *
 * `metadata` va primero porque es la CONFIRMADA para esta familia de APIs: el endpoint
 * hermano `/api/onesiteex/catalogo-opcion/maestros` responde
 * `{ success, statusCode, message, data: [...], metadata: { total, page, limit } }`.
 * Las demás son tolerancia por si la precarga se desvía del hermano.
 */
const CLAVES_META = ['metadata', 'meta', 'pagination', 'paginacion', 'paginado'];

/** Extrae el arreglo de filas de la envoltura, mirando un nivel hacia dentro. */
const extraerFilas = (cuerpo: unknown): FilaServidor[] => {
  if (Array.isArray(cuerpo)) return cuerpo.filter(esFilaServidor);
  if (!esFilaServidor(cuerpo)) return [];

  for (const clave of CLAVES_DATOS) {
    const nivel1 = cuerpo[clave];
    if (Array.isArray(nivel1)) return nivel1.filter(esFilaServidor);
    if (esFilaServidor(nivel1)) {
      for (const interna of CLAVES_DATOS) {
        const nivel2 = nivel1[interna];
        if (Array.isArray(nivel2)) return nivel2.filter(esFilaServidor);
      }
    }
  }
  return [];
};

/**
 * ¿Queda otra página?
 *
 * Se prefiere SIEMPRE la metadata explícita del servidor sobre la heurística de
 * "página incompleta". Con `limit` fijo y un total múltiplo exacto del tamaño de
 * página, la heurística pide una página de más; inofensivo, pero con el rate limiting
 * de este servicio (60 peticiones/minuto) conviene no gastar llamadas de balde.
 */
const quedanPaginas = (cuerpo: unknown, pagina: number, recibidas: number, acumuladas: number, limite: number): boolean => {
  // Una página incompleta significa que el servidor se quedó sin filas: manda SIEMPRE,
  // por encima de cualquier total. Sin esta condición, un `total` que cuente filas que
  // aquí se descartan (sin id, o duplicadas entre páginas) haría girar el bucle hasta
  // la cota dura, gastando 200 peticiones contra un servicio con rate limiting.
  if (recibidas < limite) return false;

  const meta = esFilaServidor(cuerpo)
    ? (CLAVES_META.map((c) => cuerpo[c]).find(esFilaServidor) ?? cuerpo)
    : null;

  if (meta) {
    const totalPaginas = numeroDe(meta, 0, 'totalPages', 'total_pages', 'totalPaginas', 'paginas', 'pageCount');
    if (totalPaginas > 0) return pagina < totalPaginas;

    // Con `metadata.total` se corta en la última página exacta. Sin él habría que pedir
    // una página de más para descubrir que estaba vacía.
    const total = numeroDe(meta, -1, 'total', 'totalRegistros', 'totalItems', 'count', 'totalCount');
    if (total >= 0) return acumuladas < total;
  }
  return true;
};

/** Descarga paginada de la cartera. Propaga el error para que lo clasifique el llamador. */
const descargarCartera = async (
  opciones: OpcionesPrecarga,
  etiquetas: EtiquetasTarjeta,
  etiquetasPorPregunta: ReadonlyMap<string, string>,
): Promise<ClienteAsignado[]> => {
  const limite = await obtenerParametroNumerico('SYNC_PRECARGA_LIMIT', 250);
  // Solo se descargan las que siguen pendientes en el servidor. Al finalizar una
  // encuesta, el /submit marca su fila de pre.Precarga como FINALIZADO, así que deja de
  // entrar en este filtro y no se re-descarga como pendiente. Tunable por si el
  // servicio cambia el nombre del estado; vacío = no enviar (trae todos).
  // Vacío por defecto: se traen TODOS los estados. Hace falta para DETECTAR las
  // revocaciones del admin (ANULADO) y los rechazos (RECHAZADO) por su Estado, no por
  // ausencia. FINALIZADO mapea a completado (oculto) y no reaparece como pendiente.
  const estadoDescarga = (await obtenerParametro('AGENDA_ESTADO_DESCARGA', '')).trim();

  /**
   * Sin identidad NO se pide nada. El servicio, consultado sin filtro de asesor,
   * devuelve la cartera de TODOS los encuestadores de la empresa (comprobado: 17 filas
   * de dos asesores distintos). Omitir el filtro "porque no se pudo leer el id" le
   * mostraría al asesor los clientes de otro y los guardaría en su dispositivo — datos
   * personales de terceros en un equipo que no les corresponde. Es preferible fallar.
   */
  const filtro = await leerFiltroAsesor();
  if (!filtro) {
    throw new Error(
      'No se pudo identificar al asesor de la sesión; se omite la descarga de la ' +
        'cartera para no traer la de otros encuestadores.',
    );
  }

  const filas: ClienteAsignado[] = [];
  const vistos = new Set<string>();

  // Cota dura: un servicio que ignorase `page` devolvería siempre la primera y el bucle
  // no terminaría nunca, colgando el sync en pleno campo. Con el límite por defecto son
  // 50.000 clientes, muy por encima de los ~2.000 previstos por asesor.
  const MAX_PAGINAS = 200;

  // `page` es 1-based: pedir la página 0 devuelve vacío en la mayoría de paginadores y
  // se leería como "no hay cartera".
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
    const respuesta = await apiClientAgenda.get<unknown>('', {
      params: {
        page: pagina,
        limit: limite,
        // Solo se envía lo que se tiene: un `idEncuesta=undefined` en la query se
        // serializaría como cadena vacía y podría filtrar por "ninguna encuesta".
        ...(opciones.idEncuesta ? { idEncuesta: opciones.idEncuesta } : {}),
        [filtro.campo]: filtro.valor,
        // Solo las pendientes en el servidor (por defecto 'CARGADO'). Las FINALIZADO ya
        // no vuelven; las revocadas (ANULADO/RECHAZADO) tampoco, y como el purgado por
        // ausencia está desactivado, una fila que deja de venir NO se borra del equipo.
        ...(estadoDescarga !== '' ? { estado: estadoDescarga } : {}),
        // `idEmpresa` no se envía: el dispositivo solo guarda `company_name` (el
        // nombre), nunca el id, y el servicio ya acota por la apiKey y el usuario.
      },
    });

    const cuerpo = respuesta.data;

    // El servicio marca los fallos con `success: false` y HTTP 200 en algunos casos;
    // tratarlo como éxito guardaría una cartera vacía y borraría la buena por ausencia.
    if (esFilaServidor(cuerpo) && cuerpo.success === false) {
      const detalle = textoDe(cuerpo, 'message', 'error') ?? 'sin detalle';
      throw new Error(`El servicio de cartera respondió success=false: ${detalle}`);
    }

    const crudas = extraerFilas(cuerpo);
    crudas.forEach((cruda) => {
      const cliente = aClienteAsignado(cruda, etiquetas, etiquetasPorPregunta);
      // Una fila sin id o sin encuesta no se puede reconciliar; se descarta con aviso
      // en vez de inventarle una clave, que crearía duplicados en cada ciclo.
      if (!cliente) {
        console.warn('[AGENDA] Fila de cartera descartada: le falta id o id_encuesta.');
        return;
      }
      // Un paginador mal implementado puede repetir filas entre páginas; deduplicar
      // aquí evita que el mismo cliente se cree dos veces.
      if (vistos.has(cliente.id_cliente)) return;
      vistos.add(cliente.id_cliente);
      filas.push(cliente);
    });

    if (!quedanPaginas(cuerpo, pagina, crudas.length, filas.length, limite)) break;
  }

  return filas;
};

/**
 * Sincroniza la cartera. NUNCA lanza: un fallo aquí no puede tumbar el ciclo completo,
 * porque la fase 1 (subida de capturas) es lo único verdaderamente irrecuperable.
 */
export const sincronizarClientesAsignados = async (
  databaseInstance: Database,
  opciones: OpcionesPrecarga = {},
): Promise<ResultadoPrecarga> => {
  if (cargaEnCurso) {
    return { ok: false, recibidos: 0, motivo: 'OCUPADO' };
  }

  if (!agendaConfigurada()) {
    console.warn(
      '[AGENDA] EXPO_PUBLIC_CARGA_AGENDA_CLIENTES no llegó al bundle: se omite la ' +
        'descarga de la cartera. Lo ya descargado sigue disponible sin conexión.',
    );
    return { ok: false, recibidos: 0, motivo: 'SIN_CONFIGURAR' };
  }

  cargaEnCurso = true;
  try {
    const etiquetas = await leerEtiquetas();
    const etiquetasPorPregunta = await leerEtiquetasPorPregunta(databaseInstance);
    const filas = await descargarCartera(opciones, etiquetas, etiquetasPorPregunta);
    const coleccion = databaseInstance.collections.get<LocalClientePendiente>(TABLA_AGENDA);

    // Solo las filas de las que esta función es dueña. El filtro por origen se aplica
    // en memoria, igual que en los catálogos, para no depender del escapado de SQL.
    const condiciones = opciones.idEncuesta ? [Q.where('id_encuesta', opciones.idEncuesta)] : [];
    const todas = await coleccion.query(...condiciones).fetch();
    const propias = todas.filter((r) => r.origen === 'PRECARGA');
    const porId = new Map(propias.map((r) => [r.id_cliente, r]));

    /**
     * NO hay purgado por ausencia. La descarga filtra por estado (`CARGADO`), así que
     * una fila que ya no viene puede estar FINALIZADA o revocada — indistinguibles sin
     * un `deleted[]` que el servicio no ofrece. Borrar por ausencia arriesgaría tirar
     * capturas de campo sin subir por un simple cambio de estado. La reconciliación es
     * SOLO upsert de lo que llega; las finalizadas quedan ocultas por su
     * `estado_gestion = 1` local. Efecto colateral deseable: una respuesta vacía ya no
     * puede borrar absolutamente nada.
     */
    await databaseInstance.write(async () => {
      const lote: LocalClientePendiente[] = [];

      filas.forEach((cliente) => {
        const existente = porId.get(cliente.id_cliente);

        if (!existente) {
          lote.push(
            coleccion.prepareCreate((r) => {
              r.id_cliente = cliente.id_cliente;
              r.id_encuesta = cliente.id_encuesta;
              r.nombre = cliente.nombre;
              // `codigo` es el literal que la tarjeta y el Dashboard ya usan como
              // eyebrow; para la cartera se llena con el expediente y jamás con
              // 'AD-HOC', que es el centinela de los clientes creados en campo.
              r.codigo = cliente.expediente ?? cliente.documento ?? '';
              r.origen = 'PRECARGA';
              r.estado_gestion = cliente.estado_gestion_inicial;
              r.motivo_rechazo = null;
              r.documento = cliente.documento;
              r.cuenta = cliente.cuenta;
              r.operacion = cliente.operacion;
              r.expediente = cliente.expediente;
              r.ubicacion = cliente.ubicacion;
              r.busqueda_normalizada = cliente.busqueda_normalizada;
              r.valores_json = cliente.valores_json;
              r.estado_servidor = cliente.estado_servidor;
            }),
          );
          return;
        }

        // Se revoca solo si el asesor NO ha tocado la fila. Si ya la gestionó o la
        // canceló, su decisión manda y la retirada queda constando en `estado_servidor`:
        // ocultarle una encuesta que ya trabajó sería peor que mostrar una de más.
        const revocarAhora = estaRevocado(cliente.estado_servidor) && existente.estado_gestion === 0;

        /**
         * El servidor NO degrada un nombre que ya sirve.
         *
         * Sin esto, pulsar "Cargar datos" después de capturar revertía la tarjeta al
         * valor con el que llegó de la precarga: el asesor escribía el nombre, la
         * tarjeta lo adoptaba, y la siguiente recarga lo devolvía a "CLIENTE SIN
         * NOMBRE" o al DPI. Como la precarga trae `nombres` nulo en la práctica, era
         * el caso normal, no la excepción.
         *
         * La regla es asimétrica a propósito: si el servidor SÍ manda un nombre real,
         * manda él —es el dato de BackOffice—; si manda un marcador, se conserva lo que
         * el dispositivo ya tenía.
         */
        const conservarNombreLocal =
          esNombreMarcador(cliente.nombre, cliente.documento) &&
          !esNombreMarcador(existente.nombre, existente.documento);

        lote.push(
          existente.prepareUpdate((r) => {
            if (!conservarNombreLocal) r.nombre = cliente.nombre;
            r.codigo = cliente.expediente ?? cliente.documento ?? r.codigo;
            r.documento = cliente.documento;
            r.cuenta = cliente.cuenta;
            r.operacion = cliente.operacion;
            r.expediente = cliente.expediente;
            r.ubicacion = cliente.ubicacion;
            r.busqueda_normalizada = cliente.busqueda_normalizada;
            r.valores_json = cliente.valores_json;
            r.estado_servidor = cliente.estado_servidor;
            // `estado_gestion` y `motivo_rechazo` NO se tocan: son del asesor.
            if (revocarAhora) r.estado_gestion = 2;
          }),
        );
      });

      if (lote.length > 0) await databaseInstance.batch(lote);
    });

    return { ok: true, recibidos: filas.length };
  } catch (error) {
    // Un error de red no trae `response`; distinguirlo permite que el botón diga "sin
    // conexión" en vez de "error del servidor", que manda a depurar donde no es.
    const sinRed = axios.isAxiosError(error) && !error.response;
    console.warn('[AGENDA] No se pudo actualizar la cartera de clientes:', error);
    await registrarError('clientesAsignados.sincronizar', error, {
      idEncuesta: opciones.idEncuesta ?? null,
    });
    return { ok: false, recibidos: 0, motivo: sinRed ? 'SIN_RED' : 'ERROR' };
  } finally {
    cargaEnCurso = false;
  }
};

/**
 * Recarga de una sola encuesta, para el botón "Cargar datos" de la agenda.
 *
 * Se diferencia del ciclo automático SOLO en el ámbito: aquí se acota a una encuesta,
 * y con ello también el conjunto donde se buscan bajas por ausencia.
 */
/**
 * Empuja al servidor los RECHAZOS que el asesor hizo offline.
 *
 * "Cancelar Gestión" marca la fila local (estado_gestion=2 + motivo) sin red. Esta
 * fase, en el sync, lleva ese rechazo a pre.Precarga vía el backend propio
 * (POST /surveys/precarga-estado), que hace UPDATE ... Estado='RECHAZADO'
 * WHERE Estado='CARGADO'. Es la contraparte de FINALIZADO, que viaja en /submit.
 *
 * Pendientes = filas PRECARGA canceladas cuyo estado_servidor aún no es RECHAZADO.
 * Tras un 200 se sella estado_servidor='RECHAZADO' para no re-empujar. NUNCA lanza:
 * un fallo aquí no puede tumbar el ciclo; se reintenta al siguiente sync.
 */
export const empujarRechazosPendientes = async (databaseInstance: Database): Promise<void> => {
  try {
    const coleccion = databaseInstance.collections.get<LocalClientePendiente>(TABLA_AGENDA);
    const canceladas = await coleccion.query(Q.where('estado_gestion', 2)).fetch();
    const pendientes = canceladas.filter(
      (r) => r.origen === 'PRECARGA' && (r.estado_servidor || '').toUpperCase() !== 'RECHAZADO',
    );

    for (const fila of pendientes) {
      try {
        await apiClient.post('/surveys/precarga-estado', {
          idPrecarga: fila.id_cliente,
          estado: 'RECHAZADO',
        });
        await databaseInstance.write(async () => {
          await fila.update((r) => {
            r.estado_servidor = 'RECHAZADO';
          });
        });
      } catch (e) {
        // Se reintenta en el próximo ciclo; no aborta el resto de la cola.
        await registrarError('clientesAsignados.rechazo', e, { idPrecarga: fila.id_cliente });
      }
    }
  } catch (e) {
    console.warn('[AGENDA] No se pudieron empujar los rechazos pendientes:', e);
  }
};

export const recargarEncuesta = async (
  databaseInstance: Database,
  idEncuesta: string,
): Promise<ResultadoPrecarga> => {
  const resultado = await sincronizarClientesAsignados(databaseInstance, { idEncuesta });

  if (resultado.ok) {
    // Marca puramente informativa ("act. hace N min"). Vive en una clave propia para
    // que NO participe del filtro de deltas ni del ACK: si compartiera clave con el
    // cursor real, esta recarga parcial ocultaría cambios de las demás encuestas.
    try {
      await databaseInstance.write(async () => {
        const coleccion = databaseInstance.collections.get<MetadataSync>('metadata_sync');
        const clave = claveUltimaCargaManual(idEncuesta);
        const existentes = await coleccion.query(Q.where('tabla_nombre', clave)).fetch();
        const ahora = new Date();
        if (existentes.length > 0) {
          await existentes[0].update((r: MetadataSync) => {
            r.fecha_ultima_sinc = ahora;
          });
        } else {
          await coleccion.create((r: MetadataSync) => {
            r.tabla_nombre = clave;
            r.fecha_ultima_sinc = ahora;
          });
        }
      });
    } catch (e) {
      console.warn('[AGENDA] No se pudo anotar la fecha de la última carga manual:', e);
    }
  }

  return resultado;
};
