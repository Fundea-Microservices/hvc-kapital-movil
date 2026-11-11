import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ContextoCaptura } from './multimedia.service';

/**
 * Recuerda QUÉ pregunta abrió la cámara, para poder recuperar la foto si Android mata
 * el proceso mientras la aplicación está en segundo plano.
 *
 * EL PROBLEMA
 * La cámara consume mucha memoria y en gama baja el sistema puede destruir la
 * actividad de la aplicación mientras el usuario encuadra. Al volver, la foto SÍ se
 * tomó, pero la promesa de `launchCameraAsync` murió con el proceso: nadie la recibe y
 * la evidencia se pierde en silencio. El asesor jura haber tomado la foto y el campo
 * aparece vacío — un fallo imposible de diagnosticar desde soporte.
 *
 * `ImagePicker.getPendingResultAsync()` entrega ese resultado huérfano al arrancar,
 * PERO no indica a qué pregunta correspondía. Por eso hay que anotarlo antes.
 *
 * POR QUÉ AsyncStorage Y NO LA BASE NI SecureStore
 *  - WatermelonDB puede no estar lista en el instante del arranque en que se consulta
 *    el resultado pendiente, y esto tiene que leerse lo antes posible.
 *  - `SecureStore` está para secretos y su cifrado no aporta nada aquí: la coordenada
 *    de una pregunta no es información sensible.
 *  - Sobrevive a la muerte del proceso, que es exactamente el requisito.
 */

const CLAVE = 'multimedia.captura_pendiente';

/** Ventana de validez. Pasado ese plazo, la nota se considera basura. */
const VIGENCIA_MS = 30 * 60 * 1000;

interface NotaPendiente {
  contexto: ContextoCaptura;
  /** Epoch de cuándo se abrió la cámara. */
  epochMs: number;
}

const esContextoValido = (valor: unknown): valor is ContextoCaptura => {
  if (typeof valor !== 'object' || valor === null) return false;
  const c = valor as Record<string, unknown>;
  return typeof c.idEncuesta === 'string'
    && typeof c.idPregunta === 'string'
    && typeof c.uuidBase === 'string';
};

/** Se llama JUSTO ANTES de abrir la cámara. */
export const anotarCapturaPendiente = async (contexto: ContextoCaptura): Promise<void> => {
  try {
    const nota: NotaPendiente = { contexto, epochMs: Date.now() };
    await AsyncStorage.setItem(CLAVE, JSON.stringify(nota));
  } catch (error) {
    // No se propaga: fallar aquí no debe impedir tomar la foto. Lo único que se
    // pierde es la capacidad de recuperarla en un escenario poco frecuente.
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ [Multimedia] No se pudo anotar la captura pendiente: ${detalle}`);
  }
};

/** Se llama en cuanto la cámara devuelve, con éxito o cancelada. */
export const limpiarCapturaPendiente = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(CLAVE);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ [Multimedia] No se pudo limpiar la captura pendiente: ${detalle}`);
  }
};

/**
 * Lee la nota y la CONSUME (la borra), venga o no una foto con ella.
 *
 * Se consume siempre a propósito: una nota que sobrevive a su intento reasignaría una
 * foto vieja a la siguiente pregunta que use la cámara. Es preferible perder una
 * recuperación a colocar evidencia en la respuesta equivocada, que es un error mucho
 * más grave y prácticamente indetectable.
 *
 * Devuelve `null` si no hay nota, si está corrupta o si caducó.
 */
export const consumirCapturaPendiente = async (): Promise<ContextoCaptura | null> => {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE);
    if (!crudo) return null;

    await AsyncStorage.removeItem(CLAVE);

    const parseado: unknown = JSON.parse(crudo);
    if (typeof parseado !== 'object' || parseado === null) return null;

    const nota = parseado as Record<string, unknown>;
    if (!esContextoValido(nota.contexto)) return null;

    const epochMs = typeof nota.epochMs === 'number' ? nota.epochMs : 0;
    if (Date.now() - epochMs > VIGENCIA_MS) {
      console.warn('⚠️ [Multimedia] Se descarta una captura pendiente caducada.');
      return null;
    }

    return nota.contexto;
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ [Multimedia] No se pudo leer la captura pendiente: ${detalle}`);
    return null;
  }
};
