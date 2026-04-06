import axios from 'axios';

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

export const enrollDeviceApi = async (data: EnrollPayload): Promise<EnrollResponse> => {
  const response = await axios.post<EnrollResponse>(`${API_URL}/devices/enroll`, data);
  return response.data;
};

// Nuevo método PUT para actualizar la información del equipo (Sprint 1)
export const updateMetadataApi = async (data: UpdateMetadataPayload): Promise<void> => {
  await axios.put(`${API_URL}/devices/metadata`, data);
};