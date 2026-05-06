import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { useAuthStore } from '../../presentation/store/useAuthStore';
import { wipeLocalDatabase } from '../../data/local/services/database.service'; 

console.log("🌐 URL BASE CARGADA DESDE .ENV:", process.env.EXPO_PUBLIC_API_URL);
const baseURL = process.env.EXPO_PUBLIC_API_URL;
console.log("🌐 URL BASE CARGADA DESDE baseURL:", baseURL);

export const apiClient = axios.create({
  baseURL,
  timeout: 10000,
});

// ============================================================================
// 1. INTERCEPTOR DE PETICIONES (Unificado: Logs + Inyección de Tokens)
// ============================================================================
apiClient.interceptors.request.use(
  async (config) => {
    // A. Logs de la petición
    const fullUrl = `${config.baseURL || ''}${config.url || ''}`;
    console.log(`🚀 [AXIOS INIT] -> MÉTODO: ${config.method?.toUpperCase()} | URL EXACTA: ${fullUrl}`);
    if (config.data) {
      console.log(`📦 [PAYLOAD ENVIADO]:`, JSON.stringify(config.data, null, 2));
    }

    // B. Inyección de Tokens
    const deviceToken = await SecureStore.getItemAsync('deviceToken');
    const sessionToken = await SecureStore.getItemAsync('token_sesion');
    
    if (deviceToken) {
      config.headers['x-device-token'] = deviceToken;
    }
    if (sessionToken) {
      config.headers['Authorization'] = `Bearer ${sessionToken}`;
    }
    
    return config;
  },
  (error) => Promise.reject(error)
);

// Variables para evitar múltiples llamadas de refresh simultáneas
let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) { prom.reject(error); } 
    else { prom.resolve(token); }
  });
  failedQueue = [];
};

// ============================================================================
// 2. INTERCEPTOR DE RESPUESTAS (Unificado: Logs + Refresh Token + 403)
// ============================================================================
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // A. Logs de Error Forense
    const fullUrl = `${originalRequest?.baseURL || ''}${originalRequest?.url || ''}`;
    console.log(`❌ [AXIOS ERROR] -> FALLÓ LA RUTA: ${fullUrl}`);
    console.log(`💬 DETALLE DEL ERROR:`, error.message);

    // B. SPRINT 2: Manejo de Expiración de Token (401)
    if (error.response?.status === 401 && !originalRequest._retry) {
      
      // No intentar refrescar el token si estamos en Login o Enrolamiento
      const excludedUrls = ['/auth/login', '/devices/enroll'];
      if (excludedUrls.includes(originalRequest.url)) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = 'Bearer ' + token;
          // FIX: Usar apiClient en lugar de baseURL
          return apiClient(originalRequest); 
        }).catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await SecureStore.getItemAsync('refresh_token');
        if (!refreshToken) throw new Error("No refresh token");

        const response = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
        const newToken = response.data.token_sesion;

        await SecureStore.setItemAsync('token_sesion', newToken);
        
        apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + newToken;
        originalRequest.headers['Authorization'] = 'Bearer ' + newToken;
        
        processQueue(null, newToken);
        // FIX: Usar apiClient en lugar de baseURL
        return apiClient(originalRequest); 

      } catch (refreshError) {
        processQueue(refreshError, null);
        
        // C. NUEVA LÓGICA: Expulsión elegante por sesión expirada
        console.warn('🔒 Sesión expirada o token perdido. Expulsando al Login...');
        useAuthStore.getState().wipeData(); 
        
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // D. SPRINT 4: Bloqueo Administrativo (403)
    if (error.response && error.response.status === 403) {
      const errorMessage = error.response.data?.message;

      if (errorMessage === 'Device Blocked') {
        console.warn("¡WIPE EJECUTADO!");
        await wipeLocalDatabase();
        await SecureStore.deleteItemAsync('deviceToken');
        await SecureStore.deleteItemAsync('isEnrolled');
        await SecureStore.deleteItemAsync('token_sesion');
        await SecureStore.deleteItemAsync('refresh_token');
        await SecureStore.deleteItemAsync('user_id');
        
        useAuthStore.getState().wipeData();
        Alert.alert('Equipo Bloqueado', 'Contacte a soporte.');
      } 
      else if (errorMessage === 'Update Required') {
         Alert.alert('Actualización Requerida', 'La versión de su aplicación es obsoleta. No podrá sincronizar datos.');
      }
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;