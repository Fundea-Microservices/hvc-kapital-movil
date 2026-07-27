/**
 * Intérprete de reglas lógicas y cálculos matemáticos (S3.1 y S3.2).
 */

// Diccionario tipo { "idPregunta": "valor" }
type DiccionarioRespuestas = Record<string, string>;

/**
 * Reemplaza los placeholders tipo [IdPregunta] por sus valores reales y evalúa.
 */
export const evaluarSintaxis = (sintaxis: string, respuestas: DiccionarioRespuestas): number | null => {
  if (!sintaxis) return null;

  try {
    // 1. Encontrar todos los placeholders en formato [ID]
    let expresionFinal = sintaxis;
    const placeholders = sintaxis.match(/\[(\d+)\]/g);

    if (placeholders) {
      placeholders.forEach((placeholder) => {
        // Extraer el ID sin corchetes
        const idPregunta = placeholder.replace(/[\[\]]/g, '');
        // Obtener el valor de las respuestas actuales o '0' si está vacío
        const valorReal = respuestas[idPregunta] || '0';

        // Reemplazar en la expresión
        expresionFinal = expresionFinal.replace(placeholder, valorReal);
      });
    }

    // 2. Evaluar de forma segura la expresión matemática (Ej: "45.5 + 10")
    // Se usa Function en lugar de eval() por seguridad de scope
    const resultado = new Function(`return ${expresionFinal}`)();

    return isNaN(resultado) ? null : Number(resultado);
  } catch (error) {
    console.warn(`Error evaluando sintaxis: ${sintaxis}`, error);
    return null;
  }
};

/**
 * Evalúa reglas de visibilidad tipo: "[15] > 10" o "[12] == 'SI'"
 */
export const evaluarVisibilidad = (regla: string, respuestas: DiccionarioRespuestas): boolean => {
  if (!regla) return true; // Si no hay regla, es visible por defecto [cite: 39]

  try {
    let expresionFinal = regla;
    const placeholders = regla.match(/\[(\d+)\]/g);

    if (placeholders) {
      placeholders.forEach((placeholder) => {
        const idPregunta = placeholder.replace(/[\[\]]/g, '');
        // Si es texto, se debe envolver en comillas para la evaluación lógica
        let valorReal = respuestas[idPregunta] || '';
        if (isNaN(Number(valorReal))) {
          valorReal = `'${valorReal}'`;
        }
        expresionFinal = expresionFinal.replace(placeholder, valorReal);
      });
    }

    const esVisible = new Function(`return ${expresionFinal}`)();
    return !!esVisible;
  } catch (error) {
    console.warn(`Error evaluando visibilidad: ${regla}`, error);
    return true; // En caso de fallo, mostrar por seguridad
  }
};