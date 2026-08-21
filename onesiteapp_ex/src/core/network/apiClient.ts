import axios, { AxiosRequestConfig, InternalAxiosRequestConfig }  from 'axios';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Alert } from 'react-native';
import { useAuthStore } from '../../presentation/store/useAuthStore';
import { wipeLocalDatabase } from '../../data/local/services/database.service';

const baseURL = process.env.EXPO_PUBLIC_API_URL;
const baseCatalogosURL = process.env.EXPO_PUBLIC_API_CATALOGOS_URL;

/**
 * Diagnóstico de la URL base, en el arranque.
 *
 * Las variables `EXPO_PUBLIC_*` se INCRUSTAN EN EL BUNDLE al compilar, no se leen en
 * tiempo de ejecución. Por eso editar el `.env` no cambia nada hasta reiniciar Metro
 * con la caché limpia (`npx expo start -c`) y, en una build nativa, hasta recompilar.
 * Este log muestra el valor que quedó REALMENTE dentro del bundle instalado, que es
 * la única forma de saber si el `.env` llegó a aplicarse.
 *
 * Solo se registra la URL: nunca tokens ni credenciales.
 */
const diagnosticarUrlBase = (): void => {
  console.log('🌐 [RED] URL base del API:', baseURL ?? '(SIN DEFINIR)');
  console.log('🌐 [RED] URL base de catálogos:', baseCatalogosURL ?? '(SIN DEFINIR)');

  if (!baseURL) {
    console.error(
      '❌ [RED] EXPO_PUBLIC_API_URL no llegó al bundle. Toda petición fallará con ' +
      '"Network Error" porque axios intentará resolver una ruta relativa. ' +
      'Reinicie con: npx expo start -c',
    );
    return;
  }

  // Se analiza sin `new URL()`: en Hermes su soporte es parcial y un fallo aquí
  // dejaría la app sin arrancar por un simple diagnóstico.
  const protocolo = baseURL.split('://')[0];
  const resto = baseURL.split('://')[1] ?? '';
  const autoridad = resto.split('/')[0];
  const host = autoridad.split(':')[0];
  const puerto = autoridad.includes(':') ? autoridad.split(':')[1] : '(por defecto)';

  console.log(`🌐 [RED] protocolo=${protocolo} host=${host} puerto=${puerto}`);

  // El guion bajo NO es válido en un nombre de host (RFC 952/1123). Android y muchos
  // resolvedores lo rechazan, y el fallo se manifiesta exactamente como "Network
  // Error", sin más detalle.
  if (host.includes('_')) {
    console.error(
      `❌ [RED] El host "${host}" contiene GUION BAJO, que no es válido en DNS. ` +
      'Android suele rechazarlo y el síntoma es un "Network Error" genérico. ' +
      'Use guiones medios o la IP directa.',
    );
  }

  if (protocolo === 'https') {
    console.warn(
      '⚠️ [RED] Se usa HTTPS. Si el certificado es autofirmado o no corresponde al ' +
      'host, Android lo rechaza y también aparece como "Network Error". ' +
      'Para descartarlo, pruebe temporalmente con http:// y su puerto.',
    );
  }

  if (protocolo === 'http') {
    console.log('🌐 [RED] HTTP en claro: requiere usesCleartextTraffic, que app.json ya declara.');
  }

  if (!baseURL.includes('/api/v1')) {
    console.warn(`⚠️ [RED] La URL base no contiene "/api/v1": los endpoints darán 404.`);
  }
};

diagnosticarUrlBase();

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

  // URL COMPLETA a la que se va a pegar realmente. Es el dato que falta cuando algo
  // devuelve "Network Error": revela dobles barras, un baseURL vacío o un puerto
  // perdido. Se registran los tokens solo como presente/ausente, nunca su valor.
  console.log(
    `➡️ [RED] ${(config.method || 'get').toUpperCase()} ${config.baseURL ?? ''}${config.url ?? ''} ` +
    `(device=${deviceToken ? 'sí' : 'no'} sesión=${sessionToken ? 'sí' : 'no'})`,
  );

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

  /**
   * "Network Error" es el mensaje que da axios cuando **no hubo respuesta**: la
   * petición ni siquiera llegó al servidor. El servidor puede estar perfectamente
   * sano. Las causas reales, por frecuencia:
   *   1. El host no resuelve (DNS), o lleva caracteres no válidos como el guion bajo.
   *   2. El dispositivo no alcanza esa red (IP privada estando fuera de la VPN/WiFi).
   *   3. HTTPS con certificado autofirmado o que no corresponde al host.
   *   4. HTTP en claro sin `usesCleartextTraffic` (aquí ya está declarado).
   *   5. El puerto está cerrado o el servicio no escucha.
   * Sin este bloque, el usuario solo ve el modal rojo y no queda rastro de a dónde
   * se intentó llegar.
   */
  if (!error.response) {
    console.error('❌ [RED] Sin respuesta del servidor — la petición no llegó.');
    console.error(`❌ [RED] Destino: ${originalRequest?.baseURL ?? ''}${originalRequest?.url ?? ''}`);
    console.error(`❌ [RED] Código: ${error.code ?? '(ninguno)'} | Mensaje: ${error.message}`);
    console.error(
      '❌ [RED] Verifique, en este orden: que el host resuelva, que el dispositivo ' +
      'esté en la misma red, y el certificado si es HTTPS.',
    );
  }

  if (!originalRequest) return Promise.reject(error);

  // SPRINT 2: Manejo de Expiración de Token (HTTP 401)
  if (error.response?.status === 401 && !originalRequest._retry) {
    
    // Se omiten rutas críticas de autenticación inicial para evitar bucles ciclistas
    const excludedUrls = ['/auth/login', '/devices/enroll', '/devices/unenroll'];
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
      console.warn('Sesión inválida o expirada (o tomada por otro dispositivo). Volviendo al login...');
      // Se limpia SOLO la sesión y se CONSERVA el enrolamiento → el gate cae a Login,
      // no a Enrollment. Antes se llamaba wipeData(), que des-enrolaba el equipo y
      // obligaba a re-enrolar tras una simple expiración o "toma de posesión" de sesión.
      await SecureStore.deleteItemAsync('token_sesion');
      await SecureStore.deleteItemAsync('refresh_token');
      await SecureStore.deleteItemAsync('user_id');
      await SecureStore.deleteItemAsync('user_name');
      await SecureStore.deleteItemAsync('nombre_completo');
      await SecureStore.deleteItemAsync('requiere_cambio_password');
      useAuthStore.getState().logout();
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
      await SecureStore.deleteItemAsync('company_name');
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