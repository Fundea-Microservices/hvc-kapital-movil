import axios from 'axios';
import { apiClient } from '../../core/network/apiClient';

// NOTA: Cambia esta IP por la IP local de tu computadora http://TU_IP_LOCAL:3000/api/v1 en la misma red Wi-Fi
// Ej: 'http://192.168.1.15:3000/api/v1' (No uses localhost en móvil)o  10.0.2.2 si es emulador / process.env.EXPO_PUBLIC_API_URL
const API_URL = process.env.EXPO_PUBLIC_API_URL; 

// --- DTOs y Respuestas ---
interface EnrollPayload {
  codigoEnrolamiento: string;
  hardwareId: string;
}

interface EnrollResponse {
  message: string;
  deviceToken: string;
  companyName: string;
}

interface UpdateMetadataPayload {
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
  id_rol: number;
}

// Interfaz para la respuesta de permisos
export interface PermisosResponse {
  rol: string;
  accesos: {
    lectura: boolean;
    escritura: boolean;
  };
  permisosGranulares: any; // El JSON
}

// métodos de Enrolamiento para usar apiClient
export const enrollDeviceApi = async (data: any) => {
  const response = await apiClient.post('/devices/enroll', data);
  return response.data;
};

// Nuevo método PUT para actualizar la información del equipo (Sprint 1)
export const updateMetadataApi = async (data: any) => {
  await apiClient.put('/devices/metadata', data);
};

// NUEVO: Método de Login
export const loginApi = async (data: LoginPayload): Promise<LoginResponse> => {
  const response = await apiClient.post<LoginResponse>('/auth/login', data);
  return response.data;
};

// NUEVA FUNCIÓN: Obtener permisos
// Le pasamos el token directamente para asegurar que lo envíe al instante después del login
export const getPermisosApi = async (token: string): Promise<PermisosResponse> => {
  const response = await apiClient.get<PermisosResponse>('/auth/permisos', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return response.data;
};