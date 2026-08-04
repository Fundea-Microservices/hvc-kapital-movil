import axios, { AxiosRequestConfig, InternalAxiosRequestConfig }  from 'axios';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Alert } from 'react-native';
import { useAuthStore } from '../../presentation/store/useAuthStore';
import { wipeLocalDatabase } from '../../data/local/services/database.service';

const baseURL = process.env.EXPO_PUBLIC_API_URL;
const baseCatalogosURL = process.env.EXPO_PUBLIC_API_CATALOGOS_URL;

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

/**
 * Instancia DEDICADA a la subida de archivos.
 *
 * POR QUÉ NO SE REUSA `apiClient`
 * Su interceptor de respuesta reejecuta la petición original tras un 401
 * (`return currentInstance(originalRequest)`). Con un cuerpo JSON eso es correcto,
 * pero un `FormData` que envuelve un archivo es un **stream de un solo uso**: al
 * reintentarlo ya está consumido y el servidor recibiría 0 bytes — con un 200 de
 * respuesta y un archivo vacío en disco. Un fallo silencioso que destruye evidencia.
 *
 * Comparte el interceptor de PETICIÓN (necesita los mismos tokens) pero no el de
 * respuesta: la cola de subida clasifica el error y decide si reintenta, esta vez
 * construyendo un `FormData` nuevo.
 *
 * El timeout es mucho mayor: 30 s no alcanzan para 5 MB por red móvil rural, que es
 * exactamente el escenario de esta aplicación.
 */
export const apiClientUpload = axios.create({
  baseURL,
  timeout: 120000,
});

// ============================================================================
// 1. INTERCEPTOR DE PETICIONES (Unificado: Logs + Inyección de Tokens)
// ============================================================================
const requestInterceptorInterceptor = async (config: InternalAxiosRequestConfig) => {
 
    // Inyección de Tokens
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

  // Versión de la app: permite al servidor denegar deltas si es obsoleta (Anexo 1, 4.4).
  config.headers['x-app-version'] = Application.nativeApplicationVersion || '1.0.0';

  return config;
};

apiClient.interceptors.request.use(requestInterceptorInterceptor, (error) => Promise.reject(error));
apiClientCatalogos.interceptors.request.use(requestInterceptorInterceptor, (error) => Promise.reject(error));
// Solo el de petición: ver el comentario de `apiClientUpload`.
apiClientUpload.interceptors.request.use(requestInterceptorInterceptor, (error) => Promise.reject(error));

// Variables para evitar múltiples llamadas de refresh simultáneas
let isRefreshing = false;
/** Petición en espera mientras se refresca el token (patrón single-flight). */
interface PeticionEnEspera {
  resolve: (token: unknown) => void;
  reject: (error: unknown) => void;
}

let failedQueue: PeticionEnEspera[] = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) { prom.reject(error); } 
    else { prom.resolve(token); }
  });
  failedQueue = [];
};

// ============================================================================
// 2. INTERCEPTOR DE RESPUESTAS (Unificado: Logs + Refresh Token + 403)
// ============================================================================
const responseInterceptorInterceptor = async (error: unknown) => {
  // Axios no garantiza la forma del error (puede ser de red, de config o del servidor);
  // se descarta todo lo que no sea un AxiosError antes de inspeccionarlo.
  if (!axios.isAxiosError(error)) return Promise.reject(error);

  const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
  const currentInstance = originalRequest?.baseURL === baseCatalogosURL ? apiClientCatalogos : apiClient;
  if (!originalRequest) return Promise.reject(error);

  // SPRINT 2: Manejo de Expiración de Token (HTTP 401)
  if (error.response?.status === 401 && !originalRequest._retry) {
    
    // Se omiten rutas críticas de autenticación inicial para evitar bucles ciclistas
    const excludedUrls = ['/auth/login', '/devices/enroll'];
    if (excludedUrls.includes(originalRequest.url ?? '')) {
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