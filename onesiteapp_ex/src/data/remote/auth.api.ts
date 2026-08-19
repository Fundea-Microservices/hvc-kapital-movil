import axios from 'axios';
import { apiClient } from '../../core/network/apiClient';

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

export interface LoginResponse {
  message: string;
  token_sesion: string;
  refreshToken: string;
  user_id: number;
  nombrecompleto: string; // El backend devuelve el nombre aquí (minúsculas), no en /auth/permisos
  id_rol: number;
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
export const loginApi = async (data: LoginPayload): Promise<LoginResponse> => {
  const response = await apiClient.post<LoginResponse>('/auth/login', data);
  return response.data;
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

// 5. Cambiar contraseña (primer ingreso). Operación ONLINE directa: no viaja en el
// sync. Se pasa el token explícito —igual que getPermisosApi— porque puede llamarse
// inmediatamente después del login, antes de que el interceptor lo tenga cacheado.
export const cambiarPasswordApi = async (
  data: CambiarPasswordPayload,
  token: string
): Promise<{ message: string }> => {
  const response = await apiClient.post<{ message: string }>('/auth/change-password', data, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return response.data;
};