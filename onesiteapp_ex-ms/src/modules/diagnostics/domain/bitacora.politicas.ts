/**
 * Políticas de la bitácora de errores recibida desde los dispositivos.
 *
 * El dispositivo ya sanea antes de enviar, pero eso no basta: el endpoint acepta
 * cualquier cuerpo que llegue con un token de dispositivo válido, y una app
 * manipulada —o simplemente una versión antigua con otro criterio— puede mandar
 * campos larguísimos o un lote de diez mil entradas. Estas reglas son la defensa del
 * servidor, no una repetición cortés de la del cliente.
 *
 * Módulo puro: se prueba sin base de datos ni HTTP.
 */

export type NivelBitacora = 'ERROR' | 'WARN';

export interface EntradaRecibida {
  nivel: string;
  origen: string;
  mensaje: string;
  detalle?: string | null;
  contexto?: string | null;
  versionApp?: string | null;
  plataforma?: string | null;
  fechaError?: string | null;
}

export interface EntradaNormalizada {
  nivel: NivelBitacora;
  origen: string;
  mensaje: string;
  detalle: string | null;
  contextoJson: string | null;
  versionApp: string;
  plataforma: string | null;
  fechaError: string | null;
}

/** Límites del servidor, alineados con el ancho de las columnas. */
export const MAX_ENTRADAS_POR_LOTE = 100;
export const MAX_ORIGEN = 100;
export const MAX_MENSAJE = 400;
export const MAX_DETALLE = 2500;
export const MAX_CONTEXTO = 1000;
export const MAX_VERSION = 20;

const recortar = (valor: unknown, limite: number): string =>
  String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, limite);

/**
 * Normaliza el nivel. Cualquier valor desconocido cae a `ERROR`, no se descarta: una
 * entrada con el nivel mal escrito sigue siendo información sobre un fallo real.
 */
export const normalizarNivel = (valor: unknown): NivelBitacora =>
  String(valor ?? '').trim().toUpperCase() === 'WARN' ? 'WARN' : 'ERROR';

/**
 * Valida la fecha que reporta el dispositivo.
 *
 * Un móvil con el reloj desajustado puede mandar una fecha de 1970 o del año 2090.
 * Se rechaza lo que caiga fuera de un rango razonable y se devuelve `null`, para que
 * el servidor use su propia hora de recepción: es preferible una fecha aproximada a
 * una que ordene mal la bitácora entera. Es la misma lección del cursor de sync.
 */
export const normalizarFecha = (valor: unknown, ahoraMs = Date.now()): string | null => {
  const texto = String(valor ?? '').trim();
  if (texto === '') return null;

  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return null;

  const unAnio = 365 * 24 * 60 * 60 * 1000;
  const ms = fecha.getTime();

  // Ni más de un año en el pasado, ni más de un día en el futuro.
  if (ms < ahoraMs - unAnio) return null;
  if (ms > ahoraMs + 24 * 60 * 60 * 1000) return null;

  return fecha.toISOString();
};

/** Deja la entrada lista para insertar, o `null` si no aporta nada. */
export const normalizarEntrada = (
  entrada: EntradaRecibida,
  ahoraMs = Date.now(),
): EntradaNormalizada | null => {
  const mensaje = recortar(entrada?.mensaje, MAX_MENSAJE);
  // Sin mensaje no hay nada que diagnosticar: se descarta en vez de guardar ruido.
  if (mensaje === '') return null;

  return {
    nivel: normalizarNivel(entrada.nivel),
    origen: recortar(entrada.origen, MAX_ORIGEN) || 'desconocido',
    mensaje,
    detalle: recortar(entrada.detalle, MAX_DETALLE) || null,
    contextoJson: recortar(entrada.contexto, MAX_CONTEXTO) || null,
    versionApp: recortar(entrada.versionApp, MAX_VERSION) || '0.0.0',
    plataforma: recortar(entrada.plataforma, 20) || null,
    fechaError: normalizarFecha(entrada.fechaError, ahoraMs),
  };
};

/**
 * Normaliza el lote completo, descartando lo inservible y aplicando el tope.
 *
 * Se TRUNCA en vez de rechazar el lote entero: si un dispositivo manda mil entradas,
 * quedarse con las primeras cien conserva información útil, mientras que devolver un
 * error haría que el dispositivo reintentara el mismo lote gigante indefinidamente.
 */
export const normalizarLote = (
  cuerpo: unknown,
  ahoraMs = Date.now(),
): EntradaNormalizada[] => {
  if (!Array.isArray(cuerpo)) return [];

  return cuerpo
    .slice(0, MAX_ENTRADAS_POR_LOTE)
    .map(item => normalizarEntrada(item as EntradaRecibida, ahoraMs))
    .filter((e): e is EntradaNormalizada => e !== null);
};
