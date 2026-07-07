import axios, { AxiosRequestConfig, InternalAxiosRequestConfig }  from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { useAuthStore } from '../../presentation/store/useAuthStore';
import { wipeLocalDatabase } from '../../data/local/services/database.service'; 

console.log(" URL BASE CARGADA DESDE .ENV:", process.env.EXPO_PUBLIC_API_URL);
console.log(" URL BASE CARGADA DESDE .ENV:",  process.env.EXPO_PUBLIC_API_CATALOGOS_URL);

const baseURL = process.env.EXPO_PUBLIC_API_URL;
const baseCatalogosURL = process.env.EXPO_PUBLIC_API_CATALOGOS_URL;

console.log(" URL BASE CARGADA DESDE baseURL:", baseURL);
console.log(" URL BASE CARGADA DESDE baseCatalogosURL:", process.env.EXPO_PUBLIC_API_CATALOGOS_URL);

// Instancia Central (Microservicio de Encuestas - Puerto 5030)
export const apiClient = axios.create({
  baseURL,
  timeout: 30000, // Incrementado a 30s para soportar latencias en áreas rurales
});

// Instancia Externa Dedicada (Servicio de Catálogos Maestros - Puerto 3000)
export const apiClientCatalogos = axios.create({
  baseURL: baseCatalogosURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

// ============================================================================
// 1. INTERCEPTOR DE PETICIONES (Unificado: Logs + Inyección de Tokens)
// ============================================================================
const requestInterceptorInterceptor = async (config: InternalAxiosRequestConfig) => {
 
    // A. Logs de la petición
    const fullUrl = `${config.baseURL || ''}${config.url || ''}`;
    console.log(` [AXIOS INIT] -> MÉTODO: ${config.method?.toUpperCase()} | URL EXACTA: ${fullUrl}`);
    if (config.data) {
      console.log(` [PAYLOAD ENVIADO]:`, JSON.stringify(config.data, null, 2));
    }

    // B. Inyección de Tokens
    const deviceToken = await SecureStore.getItemAsync('deviceToken');
    const sessionToken = await SecureStore.getItemAsync('token_sesion');
    const userId = await SecureStore.getItemAsync('user_id');
    
    if (deviceToken) {
      config.headers['x-device-token'] = deviceToken;
    }
    if (sessionToken) {
      config.headers['Authorization'] = `Bearer ${sessionToken}`;
    }
    if (userId) {
    config.headers['x-user-id'] = userId;
    config.headers['user-id'] = userId;
  }
  
  return config;
};

apiClient.interceptors.request.use(requestInterceptorInterceptor, (error) => Promise.reject(error));
apiClientCatalogos.interceptors.request.use(requestInterceptorInterceptor, (error) => Promise.reject(error));

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
const responseInterceptorInterceptor = async (error: any) => {
  const originalRequest = error.config;
  const currentInstance = originalRequest?.baseURL === baseCatalogosURL ? apiClientCatalogos : apiClient;
  
  // A. Logs de Error Forense en Red
  const fullUrl = `${originalRequest?.baseURL || ''}${originalRequest?.url || ''}`;
  console.log(`❌ [AXIOS ERROR] -> FALLÓ LA RUTA: ${fullUrl} | STATUS: ${error.response?.status}`);
  console.log(`[DETALLE]:`, error.message);

  // B. SPRINT 2: Manejo de Expiración de Token (HTTP 401)
  if (error.response?.status === 401 && !originalRequest._retry) {
    
    // Se omiten rutas críticas de autenticación inicial para evitar bucles ciclistas
    const excludedUrls = ['/auth/login', '/devices/enroll'];
    if (excludedUrls.includes(originalRequest.url)) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise(function(resolve, reject) {
        failedQueue.push({ resolve, reject });
      }).then(token => {
        originalRequest.headers['Authorization'] = 'Bearer ' + token;
        return currentInstance(originalRequest); 
      }).catch(err => Promise.reject(err));
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const refreshToken = await SecureStore.getItemAsync('refresh_token');
      if (!refreshToken) throw new Error("No existe Refresh Token local.");

      // Petición directa usando Axios base para eludir interceptores reactivos
      const response = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
      const newToken = response.data.token_sesion;

      // Persistencia del nuevo token transaccional
      await SecureStore.setItemAsync('token_sesion', newToken);
      
      apiClient.defaults.headers.common['Authorization'] = 'Bearer ' + newToken;
      apiClientCatalogos.defaults.headers.common['Authorization'] = 'Bearer ' + newToken;
      originalRequest.headers['Authorization'] = 'Bearer ' + newToken;
      
      processQueue(null, newToken);
      return currentInstance(originalRequest); 

    } catch (refreshError) {
      processQueue(refreshError, null);
      console.warn('Sesión corrupta o expirada. Ejecutando salida elegante...');
      useAuthStore.getState().wipeData(); 
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }

  // C. SPRINT 4: Bloqueo Administrativo (HTTP 403) - REGLA CRÍTICA 4.3
  if (error.response && error.response.status === 403) {
    const errorMessage = error.response.data?.message;

    if (errorMessage === 'Device Blocked') {
      console.warn("[WIPE DETONADO] Limpieza absoluta de almacenamiento local por bloqueo de hardware.");
      
      // Purga total y segura de la base SQLite
      await wipeLocalDatabase();
      
      // Destrucción inmediata de banderas en el SecureStore
      await SecureStore.deleteItemAsync('deviceToken');
      await SecureStore.deleteItemAsync('isEnrolled');
      await SecureStore.deleteItemAsync('token_sesion');
      await SecureStore.deleteItemAsync('refresh_token');
      await SecureStore.deleteItemAsync('user_id');
      
      // Limpieza del estado global en memoria RAM
      useAuthStore.getState().wipeData();
      Alert.alert('Equipo Bloqueado', 'Este dispositivo ha sido dado de baja. Contacte al administrador.');
    } 
    else if (errorMessage === 'Update Required') {
       Alert.alert('Actualización Requerida', 'La versión de su aplicación es obsoleta. Instale la última versión disponible.');
    }
  }
  
  return Promise.reject(error);
};

// Se acopla la regla de escucha y auditoría de respuestas a ambos clientes HTTP
apiClient.interceptors.response.use((response) => response, responseInterceptorInterceptor);
apiClientCatalogos.interceptors.response.use((response) => response, responseInterceptorInterceptor);

export default apiClient;