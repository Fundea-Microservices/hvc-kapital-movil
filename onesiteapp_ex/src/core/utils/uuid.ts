import * as Crypto from 'expo-crypto';

/**
 * La utilidad genera identificadores únicos universales (UUID v4) offline.
 * Es crítico para agrupar las respuestas de una misma fila de matriz (S4.1).
 */
export const generateUUID = (): string => {
  return Crypto.randomUUID();
};