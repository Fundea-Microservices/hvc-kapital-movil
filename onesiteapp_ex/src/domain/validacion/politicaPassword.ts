/**
 * Política de contraseña segura para el cambio obligatorio de primer ingreso.
 *
 * Es lógica de DOMINIO pura (sin React ni red): se evalúa en cada pulsación para
 * pintar los indicadores en vivo de la pantalla y para habilitar el botón. La misma
 * política vive, con idénticos criterios, en el backend (`change-password.dto.ts`);
 * esta copia es la fuente de verdad del CLIENTE y no sustituye la validación del
 * servidor, solo evita viajes de red inútiles y guía al usuario mientras teclea.
 *
 * El conjunto de caracteres especiales es EXACTO y debe coincidir con el backend.
 */
export const CARACTERES_ESPECIALES = '@#$%*!?&';

/** Longitudes admitidas, inclusivas en ambos extremos. */
export const LONGITUD_MINIMA = 8;
export const LONGITUD_MAXIMA = 20;

/** Resultado de evaluar la política: un booleano por regla + el veredicto global. */
export interface ResultadoPolitica {
  /** Entre 8 y 20 caracteres. */
  longitud: boolean;
  /** Al menos una letra mayúscula. */
  mayuscula: boolean;
  /** Al menos una letra minúscula. */
  minuscula: boolean;
  /** Al menos un número. */
  numero: boolean;
  /** Al menos un carácter especial (@#$%*!?&). */
  especial: boolean;
  /** La nueva coincide exactamente con la confirmación (y no está vacía). */
  coincideConfirmacion: boolean;
  /** La nueva es distinta a la contraseña actual (y no está vacía). */
  distintaDeActual: boolean;
  /** true solo si TODAS las reglas anteriores se cumplen. */
  esValida: boolean;
}

// Escapado de la clase de caracteres para construir la regex de forma segura, aunque
// el conjunto actual no contiene metacaracteres que rompan un character class.
const REGEX_ESPECIAL = new RegExp(
  `[${CARACTERES_ESPECIALES.replace(/[-\]\\]/g, '\\$&')}]`,
);

/**
 * Evalúa las siete reglas contra los tres campos del formulario.
 *
 * `confirmar` y `actual` participan en las dos últimas reglas: por eso la función
 * recibe el trío completo y no solo la contraseña nueva. Se comparan las cadenas tal
 * cual (sin recortar espacios): un espacio es un carácter válido en una contraseña y
 * recortarlo silenciosamente desalinearía lo que el usuario ve de lo que se envía.
 */
export const evaluarPolitica = (
  actual: string,
  nueva: string,
  confirmar: string,
): ResultadoPolitica => {
  const longitud = nueva.length >= LONGITUD_MINIMA && nueva.length <= LONGITUD_MAXIMA;
  const mayuscula = /[A-Z]/.test(nueva);
  const minuscula = /[a-z]/.test(nueva);
  const numero = /[0-9]/.test(nueva);
  const especial = REGEX_ESPECIAL.test(nueva);
  // Se exige `nueva` no vacía para que la regla no aparezca en verde antes de teclear.
  const coincideConfirmacion = nueva.length > 0 && nueva === confirmar;
  const distintaDeActual = nueva.length > 0 && nueva !== actual;

  const esValida =
    longitud &&
    mayuscula &&
    minuscula &&
    numero &&
    especial &&
    coincideConfirmacion &&
    distintaDeActual;

  return {
    longitud,
    mayuscula,
    minuscula,
    numero,
    especial,
    coincideConfirmacion,
    distintaDeActual,
    esValida,
  };
};
