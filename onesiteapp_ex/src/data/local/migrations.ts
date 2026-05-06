import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

/**
 * Por ahora lo dejamos vacío, pero es obligatorio para que synchronize 
 * no falle con el error de "Migration support".
 */
export const migrations = schemaMigrations({
  migrations: [],
});