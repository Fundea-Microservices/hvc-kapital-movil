import axios from 'axios';
import { File, Paths } from 'expo-file-system';

import { apiClientUpload } from '../../../core/network/apiClient';
import { database } from '../../local/database';
import LocalMultimedia from '../../local/models/LocalMultimedia';
import {
  ESTADO_SUBIDA,
  obtenerPendientesDeSubida,
} from '../../local/services/multimedia.service';
import { obtenerParametroNumerico } from '../../local/services/parametros.service';

export interface ResumenSubida {
  intentados: number;
  subidos: number;
  fallidos: number;
  rechazados: number;
}

/** Clasificación del resultado de un intento. Decide si se vuelve a intentar. */
export type Clasificacion = 'SUBIDO' | 'REINTENTABLE' | 'RECHAZADO' | 'ESPERAR';

/**
 * Traduce el fallo a una de las tres decisiones posibles.
 *
 * La distinción importa mucho: reintentar indefinidamente un archivo que el servidor
 * nunca va a aceptar (por peso o por extensión) consume el cupo de cada ciclo y deja
 * fuera a los archivos que sí podrían subir. Y al revés: marcar como rechazado un
 * fallo de red destruye evidencia recuperable.
 *
 * Se exporta para poder probarla directamente: es la función con más ramas del
 * archivo y llegar hasta ella simulando axios, el sistema de archivos y WatermelonDB
 * costaría mucho más que probar la decisión en sí.
 */
export const clasificarError = (error: unknown): { clase: Clasificacion; detalle: string } => {
  if (!axios.isAxiosError(error)) {
    return { clase: 'REINTENTABLE', detalle: error instanceof Error ? error.message : String(error) };
  }

  const estado = error.response?.status;
  const mensaje = error.response?.data?.message || error.message;

  // Sin respuesta: no hubo red, o expiró el tiempo. Siempre recuperable.
  if (estado === undefined) return { clase: 'REINTENTABLE', detalle: `Sin respuesta: ${mensaje}` };

  // El servidor ya lo tiene. Se trata como éxito: el índice único hizo su trabajo.
  if (estado === 409) return { clase: 'SUBIDO', detalle: 'Ya existía en el servidor' };

  // Decisiones definitivas del servidor: reintentar no cambiará nada.
  //   413 pesa demasiado · 415 extensión no permitida · 422 datos inválidos
  //   404 la captura no existe · 403 no pertenece a este usuario
  if ([403, 404, 413, 415, 422].includes(estado)) {
    return { clase: 'RECHAZADO', detalle: `HTTP ${estado}: ${mensaje}` };
  }

  // 503: el servidor responde que el almacenamiento no está configurado. NO consume
  // intentos, porque la causa es del servidor y puede tardar días en corregirse: si
  // contara, cinco sincronizaciones bastarían para marcar como rechazada toda la
  // evidencia de campo por una variable de entorno que nadie ha tocado aún.
  if (estado === 503) return { clase: 'ESPERAR', detalle: `Servidor no disponible: ${mensaje}` };

  // 401 lo resolverá el próximo ciclo con un token fresco; 5xx es del servidor.
  return { clase: 'REINTENTABLE', detalle: `HTTP ${estado}: ${mensaje}` };
};

/**
 * Sube un archivo. Construye un `FormData` NUEVO en cada intento: reutilizar uno ya
 * enviado subiría cero bytes, porque el stream del archivo se consume al leerlo.
 */
const subirArchivo = async (fila: LocalMultimedia): Promise<void> => {
  const archivo = new File(Paths.document, fila.ruta_relativa);

  if (!archivo.exists) {
    // El binario desapareció (sistema operativo, o un barrido demasiado agresivo).
    // Se marca como rechazado: no hay nada que reintentar.
    throw Object.assign(new Error('El archivo local ya no existe'), {
      esArchivoAusente: true,
    });
  }

  const cuerpo = new FormData();
  // `File` de expo-file-system@55 implementa Blob, así que va directo al FormData sin
  // el antiguo hack de `{ uri, name, type }` de los SDK anteriores.
  cuerpo.append('archivo', archivo as unknown as Blob, fila.nombre_original || archivo.name);
  cuerpo.append('idCaptura', String(fila.id_captura_servidor));
  cuerpo.append('idPregunta', String(fila.id_pregunta));
  cuerpo.append('tipoMedio', fila.tipo_medio);
  cuerpo.append('claveInstancia', fila.uuid_instancia || '');
  cuerpo.append('secuencia', String(fila.secuencia || 1));
  cuerpo.append('extension', fila.extension);
  cuerpo.append('nombreOriginal', fila.nombre_original || '');
  cuerpo.append('fechaCaptura', new Date(fila.fecha_captura).toISOString());

  await apiClientUpload.post('/multimedia', cuerpo, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

/** Aplica el resultado de un intento sobre la fila local. */
const registrarResultado = async (
  fila: LocalMultimedia,
  clase: Clasificacion,
  detalle: string,
  maxIntentos: number,
): Promise<Clasificacion> => {
  // Un archivo que agotó los reintentos deja de consumir cupo en cada ciclo, pero su
  // fila y su binario SIGUEN AHÍ: queda visible en el indicador de pendientes para que
  // alguien pueda diagnosticarlo. Nunca se borra evidencia automáticamente.
  const agotado = clase === 'REINTENTABLE' && fila.intentos + 1 >= maxIntentos;
  const claseFinal: Clasificacion = agotado ? 'RECHAZADO' : clase;

  await database.write(async () => {
    await fila.update(registro => {
      if (claseFinal === 'ESPERAR') {
        // El archivo sigue pendiente y el contador NO avanza: la causa es del
        // servidor y no se resuelve reintentando.
        registro.estado_subida = ESTADO_SUBIDA.PENDIENTE;
        registro.ultimo_error = detalle;
      } else if (claseFinal === 'SUBIDO') {
        registro.estado_subida = ESTADO_SUBIDA.SUBIDO;
        registro.fecha_subida = Date.now();
        registro.ultimo_error = null;
      } else if (claseFinal === 'RECHAZADO') {
        registro.estado_subida = ESTADO_SUBIDA.RECHAZADO;
        registro.intentos = fila.intentos + 1;
        registro.ultimo_error = agotado ? `Reintentos agotados. ${detalle}` : detalle;
      } else {
        registro.estado_subida = ESTADO_SUBIDA.ERROR;
        registro.intentos = fila.intentos + 1;
        registro.ultimo_error = detalle;
      }
    });
  });

  return claseFinal;
};

/**
 * FASE 1.B del ciclo de sincronización: sube los binarios pendientes.
 *
 * Corre DESPUÉS del `/submit` —que es quien entrega el `IdCaptura`— y antes del pull.
 * Recoge también archivos de envíos anteriores cuyo binario falló, así que un ciclo
 * malo no condena la evidencia.
 *
 * SECUENCIAL A PROPÓSITO. Subir en paralelo sobre una red móvil rural degrada el
 * ancho de banda de todas las peticiones y multiplica los tiempos de espera; además,
 * el cupo por ciclo existe para que un asesor con 300 fotos no bloquee las fases
 * siguientes del sync. Lo que no sube hoy, sube en la próxima corrida.
 */
export const subirMultimediaPendiente = async (): Promise<ResumenSubida> => {
  const resumen: ResumenSubida = { intentados: 0, subidos: 0, fallidos: 0, rechazados: 0 };

  const maxPorSync = await obtenerParametroNumerico('MULTIMEDIA_MAX_POR_SYNC', 20);
  const maxIntentos = await obtenerParametroNumerico('MULTIMEDIA_MAX_INTENTOS', 5);

  const pendientes = await obtenerPendientesDeSubida(maxPorSync);
  if (pendientes.length === 0) return resumen;

  console.log(`📤 [Multimedia] ${pendientes.length} archivo(s) por subir en este ciclo.`);

  for (const fila of pendientes) {
    resumen.intentados += 1;

    try {
      await subirArchivo(fila);
      await registrarResultado(fila, 'SUBIDO', '', maxIntentos);
      resumen.subidos += 1;
    } catch (error) {
      const ausente = (error as { esArchivoAusente?: boolean })?.esArchivoAusente === true;
      const { clase, detalle } = ausente
        ? { clase: 'RECHAZADO' as Clasificacion, detalle: 'El archivo local ya no existe' }
        : clasificarError(error);

      const claseFinal = await registrarResultado(fila, clase, detalle, maxIntentos);

      if (claseFinal === 'ESPERAR') {
        // No tiene sentido intentar los demás: el servidor no tiene dónde guardarlos.
        // Se corta el ciclo para no gastar batería ni datos del asesor.
        resumen.fallidos += 1;
        console.warn(`⏸️ [Multimedia] Ciclo detenido, el servidor no acepta archivos: ${detalle}`);
        break;
      }

      if (claseFinal === 'SUBIDO') resumen.subidos += 1;
      else if (claseFinal === 'RECHAZADO') {
        resumen.rechazados += 1;
        console.error(`❌ [Multimedia] ${fila.ruta_relativa} rechazado: ${detalle}`);
      } else {
        resumen.fallidos += 1;
        console.warn(`⚠️ [Multimedia] ${fila.ruta_relativa} reintentable: ${detalle}`);
      }
    }
  }

  console.log(
    `📤 [Multimedia] Ciclo terminado: ${resumen.subidos} subidos, ` +
    `${resumen.fallidos} para reintentar, ${resumen.rechazados} rechazados.`,
  );

  return resumen;
};
