import { database } from '../database';
import UsuarioPerfil from '../models/UsuarioPerfil';

export const saveUserProfileLocal = async (perfil: {
  id_usuario: number;
  nombre: string;
  rol: string;
  permisos: any;
}) => {
  await database.write(async () => {
    // 1. Limpiar perfiles anteriores (Regla: 1 usuario por dispositivo)
    const collection = database.get<UsuarioPerfil>('usuario_perfil');
    const existing = await collection.query().fetch();
    
    for (const record of existing) {
      await record.destroyPermanently();
    }

    // 2. Crear el nuevo registro de perfil
    await collection.create((record) => {
      record.id_usuario = perfil.id_usuario;
      record.nombre = perfil.nombre;
      record.rol = perfil.rol;
      record.permisos_json = JSON.stringify(perfil.permisos);
      record.ultimo_login = new Date();
    });
  });
};

/**
 * Borra permanentemente los datos del perfil del usuario en SQLite.
 * Se usa en Logout o cuando el dispositivo es bloqueado (Wipe).
 */
export const clearUserProfileLocal = async () => {
  await database.write(async () => {
    const collection = database.get<UsuarioPerfil>('usuario_perfil');
    const allRecords = await collection.query().fetch();
    
    // Borrado físico de los registros
    for (const record of allRecords) {
      await record.destroyPermanently();
    }
  });
};