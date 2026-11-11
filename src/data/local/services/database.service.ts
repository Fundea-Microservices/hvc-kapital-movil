import { database } from '../database';

/**
 * SPRINT 4: Acción de Limpieza (Wipe)
 * Destruye físicamente todos los registros de todas las tablas en SQLite.
 * Debe usarse EXCLUSIVAMENTE cuando el dispositivo es reportado como robado/bloqueado.
 */
export const wipeLocalDatabase = async () => {
  try {
    await database.write(async () => {
      // Esta función vacía la base de datos completa de WatermelonDB de golpe
      await database.unsafeResetDatabase();
    });
  } catch (error) {
    console.error("Error crítico al intentar destruir la base de datos:", error);
  }
};