import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { useAuthStore } from '../../presentation/store/useAuthStore';
import { wipeLocalDatabase } from '../../data/local/services/database.service'; 

console.log("🌐 URL BASE CARGADA DESDE .ENV:", process.env.EXPO_PUBLIC_API_URL);
// Usamos la variable de entorno 
//const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1';
const baseURL = process.env.EXPO_PUBLIC_API_URL;

console.log("🌐 URL BASE CARGADA DESDE baseURL:", baseURL);

export const apiClient = axios.create({
  baseURL,
  timeout: 10000,
});

// 2. Interceptor de Peticiones (El radar antes del disparo)
apiClient.interceptors.request.use((config) => {
  const fullUrl = `${config.baseURL || ''}${config.url || ''}`;
  console.log(`🚀 [AXIOS INIT] -> MÉTODO: ${config.method?.toUpperCase()} | URL EXACTA: ${fullUrl}`);
  // Imprimir qué datos le estamos mandando al backend (ocultando contraseñas reales en logs de prod si es necesario)
  if (config.data) {
    console.log(`📦 [PAYLOAD ENVIADO]:`, JSON.stringify(config.data, null, 2));
  }
  return config;
});

// 3. Interceptor de Errores (El forense si falla)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const fullUrl = `${error.config?.baseURL || ''}${error.config?.url || ''}`;
    console.log(`❌ [AXIOS ERROR] -> FALLÓ LA RUTA: ${fullUrl}`);
    console.log(`💬 DETALLE DEL ERROR:`, error.message);
    return Promise.reject(error);
  }
);

// INTERCEPTOR DE PETICIÓN (Request)
apiClient.interceptors.request.use(
  async (config) => {
    // Leemos los tokens del almacenamiento seguro
    const deviceToken = await SecureStore.getItemAsync('deviceToken');
    const sessionToken = await SecureStore.getItemAsync('token_sesion');
    // Inyectamos el DeviceToken en el Header personalizado
    if (deviceToken) {
      config.headers['x-device-token'] = deviceToken;
    }
    // Inyectamos el JWT de sesión en el estándar Authorization Bearer
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

// INTERCEPTOR DE RESPUESTA (Response) - CUMPLIMIENTO REGLA 4.3
// SPRINT 4: INTERCEPTOR DE RESPUESTA (Flujo Lógico y Validación 4.4)
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 1. SPRINT 2: Manejo de Expiración de Token (401)
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Si el error 401 viene de intentar iniciar sesión, NO refresques nada, solo muestra el error.
      if (originalRequest.url === '/auth/login') {
        return Promise.reject(error);
      }
      // No intentar refrescar el token si estamos en Login O en Enrolamiento
      const excludedUrls = ['/auth/login', '/devices/enroll'];
      if (excludedUrls.includes(originalRequest.url)) {
        return Promise.reject(error); // Deja pasar el error a la pantalla
      }

      if (isRefreshing) {
        // Si ya se está refrescando, encolamos las peticiones
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = 'Bearer ' + token;
          return baseURL(originalRequest);
        }).catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;


      try {
        const refreshToken = await SecureStore.getItemAsync('refresh_token');
        if (!refreshToken) throw new Error("No refresh token");

        // Llamada directa usando axios puro para no disparar el interceptor de nuevo
        const response = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
        const newToken = response.data.token_sesion;

        await SecureStore.setItemAsync('token_sesion', newToken);
        
        apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + newToken;
        originalRequest.headers['Authorization'] = 'Bearer ' + newToken;
        
        processQueue(null, newToken);
        return baseURL(originalRequest); // Reintenta la original

      } catch (refreshError) {
        processQueue(refreshError, null);
        // Si el refresh falla (expiró o fue bloqueado), hacemos logout forzoso
        useAuthStore.getState().wipeData();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // 2. SPRINT 4: Bloqueo Administrativo (403)
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
  