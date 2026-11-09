import axios from 'axios';
import { apiClient, apiClientAuth } from '../../core/network/apiClient';

// NOTA: Cambia esta IP por la IP local de tu computadora http://TU_IP_LOCAL:3000/api/v1 en la misma red Wi-Fi
// Ej: 'http://192.168.1.15:3000/api/v1' (No uses localhost en móvil)o  10.0.2.2 si es emulador / process.env.EXPO_PUBLIC_API_URL
const API_URL = process.env.EXPO_PUBLIC_API_URL;

// --- DTOs y Respuestas ---
export interface EnrollPayload {
  codigoEnrolamiento: string;
  hardwareId: string;
}

export interface EnrollResponse {
  message: string;
  deviceToken: string;
  companyName: string;
}

export interface UpdateMetadataPayload {
  deviceToken: string;
  modelo: string;
  versionSO: string;
}

// --- login fase 2 ---
export interface LoginPayload {
  username: string;
  password: string;
}

/**
 * Respuesta cruda del API de autenticación de HVC Kapital (POST /v1/auth/login).
 * Se declara lo que la app consume; el resto del cuerpo se ignora.
 */
export interface RespuestaLoginAuthApi {
  success: boolean;
  message?: string;
  data?: {
    token?: string;
    user?: {
      id?: string;
      userName?: string;
      nombreCompleto?: string;
      correo?: string | null;
      fotoUrl?: string | null;
      activo?: boolean;
      rolId?: string;
      rol?: { nombre?: string; esAdmin?: boolean } | null;
    } | null;
  } | null;
}

export interface LoginResponse {
  message: string;
  token_sesion: string;
  /** El API nuevo no emite refresh token; queda vacío mientras no exista el endpoint. */
  refreshToken: string;
  /** GUID del usuario (auth.Usuario.id). Antes era un entero del backend viejo. */
  user_id: string;
  nombrecompleto: string;
  /** Nombre del rol (auth.Rol.nombre), no su id: es lo que la app muestra. */
  rol: string;
  /** Handle de acceso (auth.Usuario.userName), para mostrarlo como @usuario. */
  usuario: string;
  /** Ruta relativa de la foto de perfil; null mientras el usuario no tenga. */
  fotoUrl: string | null;
  estado?: number;
  /**
   * Bandera de primer ingreso: cuando es `true` la app debe forzar la pantalla de
   * cambio de contraseña antes de dejar entrar al Dashboard. Es opcional para no
   * romper con backends antiguos que aún no la devuelven (se trata como `false`).
   */
  requiereCambioPassword?: boolean;
}

// --- cambio obligatorio de contraseña (primer ingreso) ---
export interface CambiarPasswordPayload {
  passwordActual: string;
  passwordNueva: string;
  confirmarPassword: string;
}

export interface TokenPayload {
  refreshToken: string;
}

// Interfaz para la respuesta de permisos
export interface PermisosResponse {
  rol: string;
  accesos: {
    lectura: boolean;
    escritura: boolean;
  };
  /** JSON de permisos granulares: arreglo de ids u objeto { idPermiso: boolean }. */
  permisosGranulares: unknown;
  /** El endpoint NO devuelve el nombre; se conserva por compatibilidad de lectura. */
  NombreCompleto?: string;
  nombreCompleto?: string;
}

// métodos de Enrolamiento para usar apiClient (Sprint 1)
export const enrollDeviceApi = async (data: EnrollPayload): Promise<EnrollResponse> => {
  const response = await apiClient.post<EnrollResponse>('/devices/enroll', data);
  return response.data;
};

// Nuevo método PUT para actualizar la información del equipo (Sprint 1)
export const updateMetadataApi = async (data: UpdateMetadataPayload): Promise<void> => {
  await apiClient.put('/devices/metadata', data);
};


// --- MÉTODOS DE LA FASE 2: AUTENTICACIÓN Y SESIÓN (Sprint 2) ---
//1. Iniciar Sesión
/**
 * Traduce la respuesta del API de auth al contrato que consume la app.
 * Lanza si falta token o id: sin ellos la sesión sería inservible y es preferible
 * fallar en el login que arrastrar un usuario a medias hasta el Dashboard.
 */
export const mapearRespuestaLogin = (cruda: RespuestaLoginAuthApi): LoginResponse => {
  const usuario = cruda.data?.user;
  const token = cruda.data?.token;

  if (!token || !usuario?.id) {
    throw new Error('El servidor no devolvió token o usuario');
  }

  return {
    message: cruda.message || 'Login successful',
    token_sesion: token,
    refreshToken: '',
    user_id: usuario.id,
    nombrecompleto: usuario.nombreCompleto || usuario.userName || '',
    usuario: usuario.userName || '',
    rol: usuario.rol?.nombre || '',
    fotoUrl: usuario.fotoUrl || null,
    estado: usuario.activo === false ? 0 : 1,
    // El API nuevo no expone la bandera de primer ingreso; sin ella no se fuerza
    // el cambio de contraseña (lastPasswordUpdate no dice si es temporal).
    requiereCambioPassword: false,
  };
};

/**
 * La foto llega como ruta relativa ("storage/perfil/x.png"). Se resuelve contra el
 * origen del API de auth, sin el "/v1": los archivos no cuelgan de la versión.
 */
export const resolverFotoPerfil = (ruta: string | null | undefined): string | null => {
  if (!ruta) return null;
  if (ruta.startsWith('http')) return ruta;
  const base = process.env.EXPO_PUBLIC_API_AUTH_URL;
  if (!base) return null;
  const origen = base.replace(/\/v\d+\/?$/, '').replace(/\/$/, '');
  return `${origen}/${ruta.replace(/^\//, '')}`;
};

export const loginApi = async (data: LoginPayload): Promise<LoginResponse> => {
  // El API exige `userName` (camelCase) y rechaza `username` con 400.
  const response = await apiClientAuth.post<RespuestaLoginAuthApi>('/auth/login', {
    userName: data.username,
    password: data.password,
  });
  return mapearRespuestaLogin(response.data);
};

/**
 * Banderas que el API de auth no conoce y nuestro backend sí: viven en `auth.Usuario`
 * y gobiernan qué hace la app tras el login.
 */
export interface SesionRegistrada {
  message: string;
  requiereCambioPassword: boolean;
  /** EMPLEADO | EMISOR | INVERSION | EMISORINVERSOR; null si no está clasificado. */
  tipoUsuario: string | null;
}

/**
 * Registra la sesión en nuestro backend tras un login hecho en el API de auth.
 * Llena `app.Sesiones` (para el corte remoto desde el BackOffice) y devuelve las
 * banderas propias de la app. El token va explícito: acaba de emitirse.
 */
export const registrarSesionApi = async (token: string): Promise<SesionRegistrada> => {
  const response = await apiClient.post<SesionRegistrada>('/auth/sesion', {}, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data;
};

/**
 * Apaga `RequiereCambioPassword` en nuestro backend tras cambiar la clave en el API
 * de auth, que no conoce esa columna. Sin esto la pantalla saldría en cada login.
 */
export const marcarPasswordCambiadaApi = async (token: string): Promise<void> => {
  await apiClient.post('/auth/password-cambiada', {}, {
    headers: { Authorization: `Bearer ${token}` },
  });
};

// 2. Cerrar Sesión (El método que estaba faltando)
export const logoutApi = async (data: TokenPayload): Promise<{ message: string }> => {
  // Llamamos al endpoint POST /auth/logout de nuestro backend
  const response = await apiClient.post('/auth/logout', data);
  return response.data;
};

// 3. Refrescar Token (Lo dejamos listo para cuando el JWT expire)
export const refreshTokenApi = async (data: TokenPayload): Promise<{ token_sesion: string }> => {
  const response = await apiClient.post('/auth/refresh', data);
  return response.data;
};

// NUEVA FUNCIÓN: Obtener Permisos Granulares
// Le pasamos el token directamente para asegurar que lo envíe al instante después del login
export const getPermisosApi = async (token: string): Promise<PermisosResponse> => {
  const response = await apiClient.get<PermisosResponse>('/auth/permisos', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return response.data;
};

// 5. Cambiar contraseña. Operación ONLINE directa: no viaja en el sync. La sirve el
// API de auth (dueño de `auth.Usuario.clave`), no nuestro backend. El token va
// explícito porque la pantalla puede abrirse justo tras el login.
export const cambiarPasswordApi = async (
  data: CambiarPasswordPayload,
  token: string,
  usuarioId: string
): Promise<{ message: string }> => {
  // El API exige el GUID en el cuerpo y nombra los campos en español.
  const response = await apiClientAuth.post<{ message?: string }>(
    '/auth/usuarios/cambiar-clave',
    {
      usuarioId,
      claveAnterior: data.passwordActual,
      claveNueva: data.passwordNueva,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return { message: response.data?.message || 'Contraseña actualizada correctamente' };
};

// 6. Eliminar registro.
export const desvincularDispositivoApi = async (): Promise<{ message: string }> => {
  const response = await apiClient.post<{ message: string }>('/devices/unenroll');
  return response.data;
};