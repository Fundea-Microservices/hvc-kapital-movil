import { Directory, File, Paths } from 'expo-file-system';
import { Q } from '@nozbe/watermelondb';

import { database } from '../database';
import LocalMultimedia from '../models/LocalMultimedia';
import { TipoMedio, construirTokenMedia } from '../../../domain/multimedia/token';
import {
  carpetaDeInstancia,
  construirNombreLocal,
  construirRutaRelativaLocal,
  resolverExtension,
} from '../../../domain/multimedia/nombres';

/** Estados de la cola de subida. */
export const ESTADO_SUBIDA = {
  PENDIENTE: 0,
  ERROR: 1,
  SUBIDO: 2,
  RECHAZADO: 3,
} as const;

/** Contexto de la respuesta que está capturando el archivo. */
export interface ContextoCaptura {
  idEncuesta: string;
  idPregunta: string;
  /** Instancia de la captura (la encuesta que se está llenando). */
  uuidBase: string;
  /** Fila de matriz; `null` para preguntas normales. */
  uuidFila?: string | null;
}

/** Lo que devuelve el selector nativo (cámara, galería o documentos). */
export interface ArchivoSeleccionado {
  uri: string;
  nombre?: string | null;
  mimeType?: string | null;
  tamanio?: number | null;
}

export interface ArchivoRegistrado {
  /** El texto que se guarda en `local_captura.valor`. */
  token: string;
  /** URI absoluta ya en almacenamiento durable, para la miniatura. */
  uri: string;
  nombreVisible: string;
  bytes: number;
}

const coleccion = () => database.get<LocalMultimedia>('local_multimedia');

/**
 * Reconstruye la URI absoluta a partir de la ruta relativa persistida.
 *
 * Es la contrapartida obligatoria de guardar rutas relativas: en iOS el directorio de
 * documentos vive bajo un contenedor cuyo UUID **cambia al actualizar la app**, así que
 * la parte absoluta debe resolverse en cada arranque y nunca almacenarse.
 */
export const resolverUri = (rutaRelativa: string): string =>
  new File(Paths.document, rutaRelativa).uri;

/**
 * Copia el archivo a almacenamiento durable y registra la fila de la cola.
 *
 * POR QUÉ SE COPIA Y NO SE GUARDA LA URI ORIGINAL
 * `launchCameraAsync` y `getDocumentAsync` devuelven rutas de CACHÉ, que el sistema
 * operativo purga cuando necesita espacio — y aquí puede haber días entre la captura y
 * la sincronización, porque el asesor trabaja sin señal. Sin la copia, el archivo
 * desaparece y la respuesta queda apuntando a la nada.
 *
 * En Android, además, `getDocumentAsync` sobre Drive u OneDrive devuelve una URI
 * `content://` con permiso efímero: deja de resolver en cuanto la app pasa a segundo
 * plano. Copiar la resuelve mientras el permiso sigue vivo.
 */
export const registrarArchivoLocal = async (
  contexto: ContextoCaptura,
  tipo: TipoMedio,
  seleccionado: ArchivoSeleccionado,
): Promise<ArchivoRegistrado> => {
  const extension = resolverExtension(
    seleccionado.nombre ?? seleccionado.uri,
    seleccionado.mimeType,
    tipo,
  );

  const epochMs = Date.now();
  const nombreLocal = construirNombreLocal(
    contexto.idPregunta,
    contexto.uuidFila,
    extension,
    epochMs,
  );
  const rutaRelativa = construirRutaRelativaLocal(contexto.uuidBase, nombreLocal);

  // Carpeta por instancia: purgar una encuesta entera es borrar un directorio.
  const carpeta = new Directory(Paths.document, carpetaDeInstancia(contexto.uuidBase));
  if (!carpeta.exists) carpeta.create({ intermediates: true, idempotent: true });

  const origen = new File(seleccionado.uri);
  const destino = new File(Paths.document, rutaRelativa);

  try {
    origen.copy(destino);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.error(`❌ [Multimedia] No se pudo copiar "${seleccionado.uri}": ${detalle}`);
    throw new Error('No se pudo guardar el archivo en el dispositivo');
  }

  // El tamaño se lee del archivo YA copiado, no del que reporta el selector: es el
  // único valor que se puede confrontar después con lo que reciba el servidor.
  const bytes = destino.size || seleccionado.tamanio || 0;
  const nombreVisible = seleccionado.nombre || nombreLocal;

  // La secuencia se calcula sobre las filas vivas de esta misma pregunta, de modo que
  // varios archivos en una pregunta no colisionen en el índice único del servidor.
  const existentes = await coleccion()
    .query(
      Q.where('uuid_base', contexto.uuidBase),
      Q.where('id_pregunta', contexto.idPregunta),
      Q.where('uuid_instancia', contexto.uuidFila ?? ''),
    )
    .fetch();

  await database.write(async () => {
    // Reemplazo: si ya había un archivo en esta misma coordenada, el asesor está
    // retomando la foto. Se borra la fila anterior y su binario, porque la respuesta
    // solo admite un valor y el archivo viejo ya no es evidencia de nada.
    for (const anterior of existentes) {
      await eliminarBinario(anterior.ruta_relativa);
      await anterior.destroyPermanently();
    }

    await coleccion().create(fila => {
      fila.id_encuesta = contexto.idEncuesta;
      fila.id_pregunta = contexto.idPregunta;
      fila.uuid_instancia = contexto.uuidFila ?? '';
      fila.uuid_base = contexto.uuidBase;
      fila.tipo_medio = tipo;
      fila.ruta_relativa = rutaRelativa;
      fila.nombre_original = nombreVisible;
      fila.extension = extension;
      fila.mime_type = seleccionado.mimeType ?? null;
      fila.tamanio_bytes = bytes;
      fila.secuencia = 1;
      fila.estado_subida = ESTADO_SUBIDA.PENDIENTE;
      fila.intentos = 0;
      fila.ultimo_error = null;
      // Deliberadamente null: el IdCaptura no existe hasta que el /submit responda.
      // Mientras tanto la fila es invisible para la cola de subida.
      fila.id_captura_servidor = null;
      fila.fecha_captura = epochMs;
      fila.fecha_subida = null;
    });
  });

  const token = construirTokenMedia({ tipo, nombreVisible, bytes });
  console.log(`📎 [Multimedia] Registrado ${rutaRelativa} (${bytes} bytes)`);

  return { token, uri: destino.uri, nombreVisible, bytes };
};

/** Borra el binario sin tocar la fila. Tolera que el archivo ya no exista. */
const eliminarBinario = async (rutaRelativa: string): Promise<void> => {
  try {
    const archivo = new File(Paths.document, rutaRelativa);
    if (archivo.exists) archivo.delete();
  } catch (error) {
    // Un archivo que no se puede borrar no debe impedir que la fila desaparezca: el
    // barrido de huérfanos lo recogerá más tarde.
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ [Multimedia] No se pudo borrar "${rutaRelativa}": ${detalle}`);
  }
};

/** Devuelve el archivo asociado a una respuesta, si lo hay. */
export const obtenerArchivoLocal = async (
  uuidBase: string,
  idPregunta: string,
  uuidFila?: string | null,
): Promise<LocalMultimedia | null> => {
  const filas = await coleccion()
    .query(
      Q.where('uuid_base', uuidBase),
      Q.where('id_pregunta', idPregunta),
      Q.where('uuid_instancia', uuidFila ?? ''),
    )
    .fetch();
  return filas[0] ?? null;
};

/**
 * Elimina el archivo de una respuesta concreta.
 *
 * Se invoca cuando el asesor borra una fila de matriz o cuando una pregunta deja de
 * ser visible y su respuesta se purga. Sin este gancho quedarían binarios huérfanos y
 * —peor— filas que la cola intentaría subir para respuestas que ya no existen.
 */
export const eliminarArchivoLocal = async (
  uuidBase: string,
  idPregunta: string,
  uuidFila?: string | null,
): Promise<void> => {
  const filas = await coleccion()
    .query(
      Q.where('uuid_base', uuidBase),
      Q.where('id_pregunta', idPregunta),
      Q.where('uuid_instancia', uuidFila ?? ''),
    )
    .fetch();

  if (filas.length === 0) return;

  await database.write(async () => {
    for (const fila of filas) {
      await eliminarBinario(fila.ruta_relativa);
      await fila.destroyPermanently();
    }
  });
};

/**
 * Purga todos los archivos de una instancia de captura.
 *
 * IMPORTANTE: solo debe llamarse cuando la encuesta se descarta, NUNCA al terminar de
 * enviarla. La encuesta sincronizada no implica que sus binarios hayan subido: son
 * ciclos independientes, y borrar aquí destruiría evidencia que aún está en cola.
 */
export const eliminarArchivosDeInstancia = async (uuidBase: string): Promise<void> => {
  const filas = await coleccion().query(Q.where('uuid_base', uuidBase)).fetch();

  await database.write(async () => {
    for (const fila of filas) {
      await fila.destroyPermanently();
    }
  });

  try {
    const carpeta = new Directory(Paths.document, carpetaDeInstancia(uuidBase));
    if (carpeta.exists) carpeta.delete();
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ [Multimedia] No se pudo borrar la carpeta de ${uuidBase}: ${detalle}`);
  }
};

/**
 * Estampa el `IdCaptura` que devolvió el `/submit` en los archivos de una instancia.
 *
 * Es el paso que hace visible la fila para la cola de subida: hasta aquí el archivo
 * existe pero no se sabe a qué captura del servidor pertenece.
 */
export const estamparIdCaptura = async (
  uuidBase: string,
  idCapturaServidor: string,
): Promise<number> => {
  const filas = await coleccion()
    .query(Q.where('uuid_base', uuidBase), Q.where('id_captura_servidor', null))
    .fetch();

  if (filas.length === 0) return 0;

  await database.write(async () => {
    await database.batch(
      filas.map(fila =>
        fila.prepareUpdate(registro => {
          registro.id_captura_servidor = idCapturaServidor;
        }),
      ),
    );
  });

  console.log(`📎 [Multimedia] ${filas.length} archivo(s) asociados a la captura ${idCapturaServidor}`);
  return filas.length;
};

/** Archivos listos para subir: tienen IdCaptura y no están subidos ni rechazados. */
export const obtenerPendientesDeSubida = async (limite: number): Promise<LocalMultimedia[]> =>
  coleccion()
    .query(
      Q.where('id_captura_servidor', Q.notEq(null)),
      Q.where('estado_subida', Q.oneOf([ESTADO_SUBIDA.PENDIENTE, ESTADO_SUBIDA.ERROR])),
      Q.sortBy('fecha_captura', Q.asc),
      Q.take(limite),
    )
    .fetch();

/** Cuenta lo que falta por subir, para el indicador del Dashboard. */
export const contarPendientesDeSubida = async (): Promise<number> =>
  coleccion()
    .query(Q.where('estado_subida', Q.oneOf([ESTADO_SUBIDA.PENDIENTE, ESTADO_SUBIDA.ERROR])))
    .fetchCount();

/**
 * Barrido de huérfanos: borra binarios cuyo registro ya no existe.
 *
 * Se acumulan cuando una escritura falla a medias o cuando el borrado del archivo no
 * pudo completarse. Es una operación de mantenimiento, no de corrección: si borra algo
 * que aún hacía falta, significa que la fila se perdió y el archivo era inalcanzable
 * de todos modos.
 */
export const barrerHuerfanos = async (): Promise<number> => {
  const raiz = new Directory(Paths.document, 'multimedia');
  if (!raiz.exists) return 0;

  const filas = await coleccion().query().fetch();
  const rutasVivas = new Set(filas.map(f => f.ruta_relativa));
  let borrados = 0;

  try {
    for (const entrada of raiz.list()) {
      if (!(entrada instanceof Directory)) continue;
      const uuidBase = entrada.name;

      for (const archivo of entrada.list()) {
        if (archivo instanceof Directory) continue;
        const relativa = `multimedia/${uuidBase}/${archivo.name}`;
        if (!rutasVivas.has(relativa)) {
          archivo.delete();
          borrados += 1;
        }
      }
    }
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ [Multimedia] Barrido incompleto: ${detalle}`);
  }

  if (borrados > 0) console.log(`🧹 [Multimedia] ${borrados} archivo(s) huérfano(s) eliminados`);
  return borrados;
};
