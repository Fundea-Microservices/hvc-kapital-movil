/**
 * Intérprete de `regla_validacion` del BackOffice — funciones puras, sin React ni
 * WatermelonDB. Extraído de `SurveyField.tsx` para que la misma lógica pueda
 * evaluarse tanto en el input (feedback visual en vivo) como en
 * `DynamicSurveyScreen.tsx` al finalizar la encuesta (bloqueo antes de enviar).
 *
 * No se reimplementa la validación como un regex único sobre el string crudo —
 * ese atajo ya rompió la validación una vez (ver CLAUDE.md, "Validation rules").
 */

export interface RangoNumerico {
  min: number;
  max: number;
}

export interface ReglaParseada {
  mascara: string | null;
  patrones: string[];
  rangos: RangoNumerico[];
}

/** `regla_validacion` vacía o ausente equivale a "sin restricciones". */
const REGLA_VACIA: ReglaParseada = { mascara: null, patrones: [], rangos: [] };

/**
 * Parsea `regla_validacion` en máscara + patrones regex + rangos numéricos.
 * Fragmenta por comas protegiendo cuantificadores `{n,m}` y argumentos de
 * funciones DSL como `RANGE(1,100)` (la coma interna no debe partir el token).
 * Traduce el DSL documentado: `DIGITS(n)`, `EMAIL()`, `RANGE(a,b)`.
 */
export const parsearReglaValidacion = (regla: string | null | undefined): ReglaParseada => {
  if (!regla) return REGLA_VACIA;

  try {
    const tokens = regla.split(/,(?![^{]*})(?![^(]*\))/).map(t => t.trim()).filter(Boolean);
    let mascaraDetectada: string | null = null;
    const patrones: string[] = [];
    const rangos: RangoNumerico[] = [];

    tokens.forEach(token => {
      if (token.includes('#')) {
        mascaraDetectada = token; // El carácter '#' identifica de forma unívoca una máscara visual
        return;
      }

      const dslDigits = token.match(/^DIGITS\(\s*(\d+)\s*\)$/i);
      if (dslDigits) {
        patrones.push(`^\\d{${dslDigits[1]}}$`);
        return;
      }
      if (/^EMAIL\(\s*\)$/i.test(token)) {
        patrones.push('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$');
        return;
      }
      const dslRange = token.match(/^RANGE\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)$/i);
      if (dslRange) {
        rangos.push({ min: parseFloat(dslRange[1]), max: parseFloat(dslRange[2]) });
        return;
      }

      patrones.push(token); // Regex crudo
    });

    return { mascara: mascaraDetectada, patrones, rangos };
  } catch (e) {
    console.error(' Error ejecutando el parseo polimórfico de reglas:', e);
    return REGLA_VACIA;
  }
};

/**
 * Aplica una máscara tipo `####-####` a un texto de entrada: extrae los
 * caracteres alfanuméricos e inyecta los separadores de la plantilla.
 */
export const aplicarMascara = (textoEntrada: string, plantilla: string | null): string => {
  if (!plantilla) return textoEntrada;

  const digitos = textoEntrada.replace(/[^a-zA-Z0-9]/g, '');
  let resultado = '';
  let indiceDigito = 0;

  for (let i = 0; i < plantilla.length && indiceDigito < digitos.length; i++) {
    if (plantilla[i] === '#') {
      resultado += digitos[indiceDigito];
      indiceDigito++;
    } else {
      resultado += plantilla[i]; // Inyecta el separador configurado (guiones, espacios, etc.)
    }
  }
  return resultado;
};

/**
 * Valida un valor contra una regla ya parseada. Semántica AND entre patrones y
 * rangos. Un valor vacío o una regla sin restricciones se consideran válidos
 * (la obligatoriedad se valida aparte, por `es_obligatorio`).
 * Ante un regex sintácticamente inválido del BackOffice, se tolera (válido) en
 * vez de bloquear al encuestador por un error ajeno a su captura.
 *
 * `mensajeError` (columna `MensajeError` del BackOffice) sustituye el texto de
 * error cuando está presente; si es null se conservan los mensajes por defecto,
 * así que una regla sin mensaje custom se comporta exactamente como antes.
 */
export const validarValor = (
  valorCrudo: string,
  regla: ReglaParseada,
  mensajeError?: string | null
): { valido: boolean; mensaje: string | null } => {
  if ((regla.patrones.length === 0 && regla.rangos.length === 0) || valorCrudo.trim() === '') {
    return { valido: true, mensaje: null };
  }

  try {
    // Si el campo opera bajo máscara, se remueven espacios/guiones antes de evaluar.
    const texto = regla.mascara ? valorCrudo.replace(/[\s-]/g, '') : valorCrudo;

    for (const patron of regla.patrones) {
      const regex = new RegExp(patron);
      if (!regex.test(texto)) {
        return { valido: false, mensaje: mensajeError || 'Formato incorrecto según regla institucional.' };
      }
    }

    for (const rango of regla.rangos) {
      const numero = parseFloat(texto.replace(',', '.'));
      if (isNaN(numero) || numero < rango.min || numero > rango.max) {
        return { valido: false, mensaje: mensajeError || `El valor debe estar entre ${rango.min} y ${rango.max}.` };
      }
    }

    return { valido: true, mensaje: null };
  } catch (error) {
    console.warn(' Sintaxis de expresión regular inválida en el BackOffice:', regla.patrones);
    return { valido: true, mensaje: null };
  }
};
