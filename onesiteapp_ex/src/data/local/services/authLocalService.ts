import { database } from '../database';
import UsuarioPerfil from '../models/UsuarioPerfil';

/** Contrato del perfil que la pantalla de Login persiste para uso offline. */
export interface PerfilOfflinePayload {
  IdUsuario: number;
  NombreCompleto: string;
  RolNombre: string;
  /** Permisos ya serializados a string para que SQLite no reciba objetos anidados. */
  Permisos: string;
}

export const authLocalService = {
  /**
   * Guarda o actualiza el perfil del usuario para acceso offline.
   * userData recibe directamente el objeto: {"IdUsuario": 1, "NombreCompleto": "...", ...}
   */
  savePerfilOffline: async (userData: PerfilOfflinePayload) => {
    try {
      return await database.write(async () => {
        const perfilCollection = database.get<UsuarioPerfil>('usuario_perfil');
        
        // 1. Limpieza de seguridad: solo permitimos un perfil activo en el dispositivo
        const registros = await perfilCollection.query().fetch();
        if (registros.length > 0) {
          await Promise.all(registros.map(r => r.destroyPermanently()));
        }

        // 2. Creación del nuevo registro con mapeo estricto a los campos de tu SQL
        await perfilCollection.create((perfil) => {
          // Usamos userData directamente porque es el objeto que viene de la API
          perfil.id_usuario = Number(userData.IdUsuario || 0); 
          perfil.nombre = userData.NombreCompleto || 'Usuario Demo';
          perfil.rol = userData.RolNombre || 'Administrador';
          
          // Convertimos el objeto de Permisos a String para SQLite
          perfil.permisos_json = JSON.stringify(userData.Permisos || {});
          
          perfil.ultimo_login = new Date();
        });
      });
    } catch (error) {
      // Capturamos cualquier error de WatermelonDB (ej: columnas faltantes o tipos erróneos)
      console.error("❌ ERROR CRÍTICO en authLocalService:", error);
      throw error; // Re-lanzamos para que LoginScreen muestre la alerta
    }
  }
};