/**
 * Contratos para las cargas útiles que devuelve el backend durante la sincronización.
 *
 * El servidor entrega los nombres de columna en tres cajas distintas según el módulo
 * (snake_case, camelCase y PascalCase del BackOffice/SQL Server). En lugar de tipar
 * cada fila como `any`, se modela como un diccionario de valores `unknown` y se
 * accede siempre mediante los lectores defensivos de este archivo, que resuelven el
 * primer alias presente y normalizan el tipo de salida.
 */

/** Fila genérica recibida del servidor: llaves desconocidas, valores sin tipar. */
export type FilaServidor = Record<string, unknown>;

/** Bloque de cambios en el formato que espera WatermelonDB. */
export interface CambiosTabla {
  created: FilaServidor[];
  updated: FilaServidor[];
  deleted: string[];
}

/** Conjunto de cambios por nombre de tabla. */
export type MapaCambios = Record<string, CambiosTabla>;

/** Verifica que un valor desconocido sea una fila utilizable. */
export const esFilaServidor = (dato: unknown): dato is FilaServidor =>
  typeof dato === 'object' && dato !== null && !Array.isArray(dato);

/**
 * Devuelve el primer alias presente y no vacío de una fila.
 * Ejemplo: leerCampo(fila, 'regla_validacion', 'reglaValidacion', 'ReglaValidacion').
 */
export const leerCampo = (fila: FilaServidor, ...alias: string[]): unknown => {
  for (const nombre of alias) {
    const valor = fila[nombre];
    if (valor !== undefined && valor !== null && valor !== '') return valor;
  }
  return null;
};

/** Lectura como texto; devuelve null si ningún alias trae valor. */
export const textoDe = (fila: FilaServidor, ...alias: string[]): string | null => {
  const valor = leerCampo(fila, ...alias);
  return valor === null ? null : String(valor);
};

/** Lectura numérica con valor por defecto ante ausencia o dato no numérico. */
export const numeroDe = (fila: FilaServidor, porDefecto: number, ...alias: string[]): number => {
  const valor = leerCampo(fila, ...alias);
  if (valor === null) return porDefecto;
  const numero = Number(valor);
  return Number.isNaN(numero) ? porDefecto : numero;
};

/** Lectura booleana en formato 1/0, tal como lo espera el esquema local. */
export const banderaDe = (fila: FilaServidor, ...alias: string[]): number => {
  const valor = leerCampo(fila, ...alias);
  return valor === 1 || valor === '1' || valor === true ? 1 : 0;
};

/**
 * Extrae el mensaje de error de una respuesta HTTP sin recurrir a `any`.
 * Cubre AxiosError (con cuerpo `{ message }`), Error nativo y valores arbitrarios.
 */
export const mensajeDeError = (error: unknown, porDefecto: string): string => {
  if (esFilaServidor(error)) {
    const respuesta = error.response;
    if (esFilaServidor(respuesta)) {
      const cuerpo = respuesta.data;
      if (esFilaServidor(cuerpo) && typeof cuerpo.message === 'string' && cuerpo.message.trim() !== '') {
        return cuerpo.message;
      }
    }
  }
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return porDefecto;
};

/** Extrae con seguridad el bloque de cambios de una tabla, con alias opcionales. */
export const obtenerCambiosTabla = (origen: unknown, ...nombres: string[]): CambiosTabla => {
  const vacio: CambiosTabla = { created: [], updated: [], deleted: [] };
  if (!esFilaServidor(origen)) return vacio;

  for (const nombre of nombres) {
    const bloque = origen[nombre];
    if (esFilaServidor(bloque)) {
      return {
        created: Array.isArray(bloque.created) ? bloque.created.filter(esFilaServidor) : [],
        updated: Array.isArray(bloque.updated) ? bloque.updated.filter(esFilaServidor) : [],
        deleted: Array.isArray(bloque.deleted) ? bloque.deleted.map(String) : [],
      };
    }
  }
  return vacio;
};
