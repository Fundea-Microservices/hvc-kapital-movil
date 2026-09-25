import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig }  from 'axios';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { Alert } from 'react-native';
import { useAuthStore } from '../../presentation/store/useAuthStore';
import { wipeLocalDatabase } from '../../data/local/services/database.service';

const baseURL = process.env.EXPO_PUBLIC_API_URL;
const baseCatalogosURL = process.env.EXPO_PUBLIC_API_CATALOGOS_URL;
/**
 * URL COMPLETA del endpoint de carga de agenda, normalizada.
 *
 * La variable se copia a mano de una especificación y llega sin protocolo con mucha
 * facilidad (`172.25.5.11:3000/api/onesiteex/precarga`). Axios trata una `baseURL` sin
 * esquema como ruta relativa y la petición ni siquiera sale del dispositivo: el
 * síntoma es un `ERR_NETWORK` genérico, idéntico al de estar fuera de cobertura, que
 * manda a depurar la red cuando el problema es una cadena de texto. Se antepone
 * `http://` en vez de rechazarla, porque el servicio vive en una IP de LAN sin TLS.
 *
 * A diferencia de las otras variables, esta contiene el endpoint ENTERO y no una base
 * a la que se le concatena una ruta — el servicio no comparte prefijo con ningún otro.
 */
const normalizarUrlAgenda = (crudo: string | undefined): string | undefined => {
  const valor = (crudo || '').trim();
  if (valor === '') return undefined;
  const tieneEsquema = valor.slice(0, 8).toLowerCase().includes('://');
  const conEsquema = tieneEsquema ? valor : 'http://' + valor;
  // Barras finales fuera: axios las conservaría y el servicio recibiría '//precarga/'.
  let fin = conEsquema.length;
  while (fin > 0 && conEsquema[fin - 1] === '/') fin -= 1;
  return conEsquema.slice(0, fin);
};

const baseAgendaURL = normalizarUrlAgenda(process.env.EXPO_PUBLIC_CARGA_AGENDA_CLIENTES);
const tokenAgenda = process.env.EXPO_PUBLIC_TOKEN_CARGA_AGENDA_CLIENTES;

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
  // Sin definir NO es un error: la carga de agenda degrada y el resto de la app sigue.
  console.log('🌐 [RED] URL base de carga de agenda:', baseAgendaURL ?? '(SIN DEFINIR)');

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

  console.log('🌐 [RED] protocolo=%s host=%s puerto=%s', protocolo, host, puerto);

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
 * Instancia DEDICADA a la carga de la agenda de clientes asignados (RF-CE-07).
 *
 * POR QUÉ UNA INSTANCIA PROPIA
 * Ese servicio es el que habla con el BackOffice y vive en su propia URL base, igual
 * que los catálogos maestros o el carrusel. Nunca se hardcodea el host: una IP de LAN
 * en el código haría que la función solo sirviera dentro de esa red.
 *
 * POR QUÉ EL TOKEN NO VA EN `Authorization`
 * El interceptor de petición compartido asigna `Authorization: Bearer <token_sesion>`
 * SIN condición, así que poner aquí el token del servicio lo pisaría. Además el propio
 * servicio lo exige en una cabecera concreta: responde 401 `API_KEY_NO_ENVIADA` con el
 * mensaje «Envíela en el encabezado `apikey`». El nombre va en MINÚSCULAS y sin guiones
 * porque es el que valida el servidor, no una convención nuestra.
 *
 * Si la variable no está definida no se envía cabecera alguna: mandar
 * `apikey: undefined` sería peor que no mandarla.
 *
 * ADVERTENCIA CONSCIENTE: todo lo prefijado `EXPO_PUBLIC_` se compila dentro del bundle
 * y se puede extraer de un APK distribuido. Este token se acepta ahí por decisión de
 * producto y debe tratarse como público (mínimo privilegio, solo lectura de la
 * cartera). NO es el patrón a seguir para el siguiente servicio: el resto se proxean
 * desde el backend precisamente por esto.
 */
export const apiClientAgenda = axios.create({
  baseURL: baseAgendaURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...(tokenAgenda ? { apikey: tokenAgenda } : {}),
  },
});

/**
 * `false` si falta `EXPO_PUBLIC_CARGA_AGENDA_CLIENTES`. Sin URL base, axios resolvería
 * una ruta relativa y fallaría con un "Network Error" indistinguible de un problema de
 * cobertura; comprobarlo antes permite degradar con un mensaje que sí explica la causa.
 */
export const agendaConfigurada = (): boolean => !!baseAgendaURL;

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
// Necesita los mismos tokens: el asesor se deriva del JWT, nunca del cuerpo.
apiClientAgenda.interceptors.request.use(requestInterceptorInterceptor, (error) => Promise.reject(error));
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
// 2. DIAGNÓSTICO DE FALLOS HTTP (compartido por todos los clientes)
// ============================================================================

/**
 * Claves cuyo valor NUNCA se escribe en el log.
 *
 */
const CLAVES_SENSIBLES = [
  'password', 'passwordactual', 'passwordnueva', 'confirmarpassword', 'contrasena',
  'token', 'token_sesion', 'refreshtoken', 'refresh_token', 'apikey', 'authorization',
  'devicetoken', 'x-device-token',
];

const censurar = (valor: unknown, profundidad = 0): unknown => {
  if (valor === null || typeof valor !== 'object' || profundidad > 3) return valor;

  if (Array.isArray(valor)) {
    const muestra = valor.slice(0, 5).map((elemento) => censurar(elemento, profundidad + 1));
    return valor.length > 5 ? [...muestra, `…(${valor.length} elementos en total)`] : muestra;
  }

  const salida: Record<string, unknown> = {};
  for (const [clave, contenido] of Object.entries(valor as Record<string, unknown>)) {
    salida[clave] = CLAVES_SENSIBLES.includes(clave.toLowerCase())
      ? '«oculto»'
      : censurar(contenido, profundidad + 1);
  }
  return salida;
};

/** Tope por línea. Más allá, logcat corta y se pierde justo el final del mensaje. */
const LIMITE_CUERPO = 700;

/**
 * Convierte un cuerpo HTTP —de petición o de respuesta— en una línea legible.
 *
 */
const resumirCuerpo = (cuerpo: unknown): string => {
  if (cuerpo === undefined || cuerpo === null || cuerpo === '') return '(vacío)';

  // FormData envuelve binarios y no es serializable: volcarlo llenaría el log de ruido.
  if (typeof FormData !== 'undefined' && cuerpo instanceof FormData) {
    return '(FormData — subida de archivo)';
  }

  let texto: string;
  if (typeof cuerpo === 'string') {
    try {
      texto = JSON.stringify(censurar(JSON.parse(cuerpo)));
    } catch {
      texto = cuerpo;
    }
  } else {
    try {
      texto = JSON.stringify(censurar(cuerpo));
    } catch {
      texto = String(cuerpo);
    }
  }

  return texto.length > LIMITE_CUERPO
    ? `${texto.slice(0, LIMITE_CUERPO)}… (${texto.length} caracteres)`
    : texto;
};

/**
 * Traduce el código HTTP a la causa que realmente lo produce en ESTA aplicación.
 *
 * El código por sí solo no dice dónde mirar, y la diferencia entre "el backend no
 * tiene esa ruta" y "el backend reventó por dentro" cambia por completo a quién le
 * toca arreglarlo.
 */
const pistaPorEstado = (estado: number, destino: string): string | null => {
  switch (estado) {
    case 400:
      return 'El cuerpo no pasó la validación del servidor. Compare «Enviado» contra el DTO del endpoint.';
    case 401:
      return 'Falta o no vale alguna credencial. La línea «Auth» de arriba dice cuáles viajaron: ' +
        'si device=no, el equipo no está enrolado; si sesión=no, no hay token_sesion guardado.';
    case 403:
      return 'Autenticado pero sin permiso: equipo bloqueado desde el BackOffice o versión obsoleta.';
    case 404:
      return `Esa ruta no existe en el host. Revise el prefijo de "${destino}" ` +
        '(debe incluir /api/v1 para el microservicio) contra el @Controller del backend.';
    case 409:
      return 'Conflicto de estado: el recurso ya existe o fue modificado por otro dispositivo.';
    case 413:
      return 'El archivo supera el tamaño que acepta el servidor.';
    case 500:
      return 'El fallo es DENTRO del servidor, no en la petición. El detalle real está en el log ' +
        'del microservicio; aquí solo llega el mensaje genérico. Suele ser SQL o un campo nulo inesperado.';
    default:
      return null;
  }
};

/**
 * Registro detallado de un fallo HTTP, con el mismo formato en toda la aplicación.
 *
 * Antes cada `catch` hacía `console.error('mensaje', error)`, y en el log de Metro un
 * AxiosError se imprime como `[AxiosError: Request failed with status code 500]`: ni la
 * URL, ni el cuerpo que respondió el servidor, ni qué se le mandó. Con varias peticiones
 * en paralelo (la sincronización lanza tres a la vez) era imposible saber cuál falló.
 *
 * `etiqueta` identifica el subsistema para poder filtrar el logcat por ella.
 */
export const registrarFalloHttp = (etiqueta: string, error: unknown): void => {
  if (!axios.isAxiosError(error)) {
    // Format string CONSTANTE con `%s`, no un template literal: esta llamada pasa un
    // segundo argumento, así que el primero actúa como format string de `util.format` y
    // un `%` dentro de `etiqueta` podría falsificar la línea del log (unsafe-formatstring
    // de Semgrep). Las demás llamadas de esta función son de un solo argumento y no
    // tienen ese problema. Mismo criterio que el resto de `console.*` del módulo.
    console.error('❌ [%s] Error ajeno a HTTP:', etiqueta, error);
    return;
  }

  const config = error.config;
  const metodo = (config?.method ?? 'get').toUpperCase();
  const destino = `${config?.baseURL ?? ''}${config?.url ?? ''}`;

  if (!error.response) {
    console.error(`❌ [${etiqueta}] SIN RESPUESTA — ${metodo} ${destino}`);
    console.error(`❌ [${etiqueta}] Código axios: ${error.code ?? '(ninguno)'} | ${error.message}`);
    return;
  }

  const { status, statusText, data } = error.response;
  console.error(`❌ [${etiqueta}] HTTP ${status} ${statusText ?? ''} — ${metodo} ${destino}`);
  console.error(`❌ [${etiqueta}] Responde: ${resumirCuerpo(data)}`);

  if (config?.data !== undefined) {
    console.error(`❌ [${etiqueta}] Enviado: ${resumirCuerpo(config.data)}`);
  }

  // Presencia de las credenciales, nunca su valor: es el dato que distingue un 401 de
  // "no enrolado" de uno de "contraseña incorrecta", y hoy había que adivinarlo.
  const cabeceras = (config?.headers ?? {}) as Record<string, unknown>;
  console.error(
    `❌ [${etiqueta}] Auth: device=${cabeceras['x-device-token'] ? 'sí' : 'no'} ` +
    `sesión=${cabeceras['Authorization'] ? 'sí' : 'no'} ` +
    `usuario=${cabeceras['x-user-id'] ?? '(ninguno)'}`,
  );

  const pista = pistaPorEstado(status, destino);
  if (pista) console.error(`❌ [${etiqueta}] Pista: ${pista}`);
};

// ============================================================================
// 3. INTERCEPTOR DE RESPUESTAS (Unificado: Logs + Refresh Token + 403)
// ============================================================================
const responseInterceptorInterceptor = async (error: unknown) => {
  // Axios no garantiza la forma del error (puede ser de red, de config o del servidor);
  // se descarta todo lo que no sea un AxiosError antes de inspeccionarlo.
  if (!axios.isAxiosError(error)) return Promise.reject(error);

  const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
  const currentInstance = originalRequest?.baseURL === baseCatalogosURL ? apiClientCatalogos : apiClient;

  // TODO fallo queda registrado aquí, con respuesta del servidor incluida, antes de
  // que cualquier `catch` de pantalla lo convierta en un mensaje para el usuario.
  registrarFalloHttp('RED', error);

  /**
   * "Network Error" es el mensaje que da axios cuando **no hubo respuesta**: la
   * petición ni siquiera llegó al servidor. El servidor puede estar perfectamente
   * sano. Las causas reales, por frecuencia:
   *   1. El host no resuelve (DNS), o lleva caracteres no válidos como el guion bajo.
   *   2. El dispositivo no alcanza esa red (IP privada estando fuera de la VPN/WiFi).
   *   3. HTTPS con certificado autofirmado o que no corresponde al host.
   *   4. HTTP en claro sin `usesCleartextTraffic` (aquí ya está declarado).
   *   5. El puerto está cerrado o el servicio no escucha.
   */
  if (!error.response) {
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

      // Petición directa usando Axios base para eludir interceptores reactivos.
      // Timeout EXPLÍCITO: `axios.post` global no hereda el timeout de `apiClient`, así
      // que sin esto un refresh que no responde deja la petición original colgada para
      // siempre (p. ej. el modal "Guardando contraseña..." nunca se cierra).
      const response = await axios.post(
        `${baseURL}/auth/refresh`,
        { refreshToken },
        { timeout: 30000 },
      );
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
/**
 * La agenda comparte el interceptor de PETICIÓN pero NO el de respuesta.
 *
 * Su 401 significa "apikey inválida o ausente", un dominio de autenticación distinto
 * del JWT de sesión. Pasarlo por el interceptor compartido provocaba tres daños, los
 * tres observados en campo:
 *
 *   1. Disparaba un refresh de `token_sesion` que NO puede arreglar una apikey mala, y
 *      reintentaba la petición: DOS llamadas por intento contra un servicio con rate
 *      limiting (60/minuto), gastando cupo para volver a fallar igual.
 *   2. Si ese refresh fallaba, el `catch` cerraba la sesión del asesor y lo mandaba a
 *      Login. Una apikey mal copiada en el `.env` podía, por esa vía, expulsar al
 *      usuario de la aplicación.
 *   3. Un 403 con el mensaje 'Device Blocked' habría ejecutado `wipeLocalDatabase()`.
 *      Ese contrato es del backend propio; un servicio de terceros no debería poder
 *      detonar el borrado de las capturas de campo por devolver un mensaje que
 *      casualmente coincida.
 *
 * Se conserva solo el diagnóstico, que es lo que hizo falta para depurar la URL base.
 * Es el mismo criterio que `apiClientUpload`: compartir lo útil, no lo destructivo.
 */
apiClientAgenda.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    registrarFalloHttp('AGENDA', error);
    if (error.response?.status === 401) {
      console.warn(
        '[AGENDA] 401 del servicio de cartera: la cabecera «apikey» falta o no es ' +
          'válida. NO es la sesión del asesor — revise ' +
          'EXPO_PUBLIC_TOKEN_CARGA_AGENDA_CLIENTES y recuerde que las variables ' +
          'EXPO_PUBLIC_* se incrustan en el bundle (hace falta: npx expo start -c).',
      );
    }
    return Promise.reject(error);
  },
);

export default apiClient;