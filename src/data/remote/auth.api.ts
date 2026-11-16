import { apiClientAuth } from '../../core/network/apiClient';
import { extraerData, extraerMensaje } from '../../core/network/envelope';

/**
 * Todo este archivo habla con el API de HVC Kapital (3200), que responde el sobre
 * `{ success, data }`. El microservicio de encuestas (5030) sigue sirviendo
 * encuestas, sincronización y multimedia desde sus propios módulos.
 */

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

/**
 * Permisos del usuario, tal como los expone `GET /auth/permisos/mis-permisos`.
 *
 * Sustituye al contrato del microservicio, que traía `accesos {lectura, escritura}`
 * y `permisosGranulares`: esa distinción no existe en la matriz del API, donde un
 * permiso es un código con su módulo y su acción.
 */
export interface PermisosResponse {
  usuarioId: string;
  /** Nombre del rol, no su id; null si el usuario no tiene rol. */
  rol: string | null;
  /** Un rol administrador recibe todos los permisos activos. */
  esAdmin: boolean;
  /** Códigos efectivos, p. ej. ['AGENDA_VER', 'ENCUESTA_RESPONDER']. */
  permisos: string[];
}

/** `true` si el usuario puede ejercer ese código de permiso. */
export const tienePermiso = (permisos: PermisosResponse, codigo: string): boolean =>
  permisos.esAdmin || permisos.permisos.includes(codigo.toUpperCase());

// Enrolamiento del equipo. Lo sirve el API (3200) desde la Fase 1.
export const enrollDeviceApi = async (data: EnrollPayload): Promise<EnrollResponse> => {
  const response = await apiClientAuth.post<unknown>('/devices/enroll', data);
  return extraerData<EnrollResponse>(response.data, 'Enrolamiento');
};

/**
 * Metadatos del equipo. El servidor identifica el equipo por la cabecera
 * `x-device-token` que inyecta el interceptor, no por el cuerpo.
 */
export const updateMetadataApi = async (data: UpdateMetadataPayload): Promise<void> => {
  await apiClientAuth.put('/devices/metadata', {
    modelo: data.modelo,
    versionSO: data.versionSO,
  });
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
  /** Credencial para renovar el JWT. El servidor la rota en cada refresh. */
  refreshToken: string;
  /** Vencimiento del refresh token, ISO 8601. */
  expiraEn: string;
  requiereCambioPassword: boolean;
  /** EMPLEADO | EMISOR | INVERSION | EMISORINVERSOR; null si no está clasificado. */
  tipoUsuario: string | null;
}

/**
 * Abre la sesión del equipo tras el login y entrega el refresh token.
 * Llena `app.Sesiones`, que permite el corte remoto desde el BackOffice. El token
 * va explícito porque acaba de emitirse y aún no está en el SecureStore.
 */
export const registrarSesionApi = async (token: string): Promise<SesionRegistrada> => {
  const response = await apiClientAuth.post<unknown>('/auth/sesion', {}, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return extraerData<SesionRegistrada>(response.data, 'Registro de sesión');
};

// 2. Cerrar sesión. Responde 200 aunque el token ya no exista.
export const logoutApi = async (data: TokenPayload): Promise<{ message: string }> => {
  const response = await apiClientAuth.post<unknown>('/auth/logout', data);
  return { message: extraerMensaje(response.data, 'Sesión cerrada') };
};

/**
 * Renovación manual del JWT. El interceptor de `apiClient` hace lo mismo de forma
 * automática ante un 401; esta función queda para renovaciones explícitas.
 * OJO: el servidor rota el refresh token, así que hay que guardar el nuevo.
 */
export const refreshTokenApi = async (
  data: TokenPayload,
): Promise<{ token_sesion: string; refreshToken: string }> => {
  const response = await apiClientAuth.post<unknown>('/auth/refresh', data);
  const datos = extraerData<{ token: string; refreshToken: string }>(
    response.data,
    'Refresh de sesión',
  );
  return { token_sesion: datos.token, refreshToken: datos.refreshToken };
};

/**
 * Permisos efectivos del usuario del token: los de su rol, más las excepciones
 * propias que permiten y menos las que niegan. Un rol admin los recibe todos.
 * El token va explícito porque la pantalla puede abrirse justo tras el login.
 */
export const getPermisosApi = async (token: string): Promise<PermisosResponse> => {
  const response = await apiClientAuth.get<unknown>('/auth/permisos/mis-permisos', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return extraerData<PermisosResponse>(response.data, 'Permisos');
};

/**
 * Opción de menú tal como la expone `GET /auth/accesos/mi-menu`.
 * El servidor ya filtró por rol, por showApp y por TipoUsuario: lo que llega
 * es exactamente lo que este usuario puede ver.
 */
export interface OpcionMenuApi {
  id: string;
  /** Id del menú padre; null en las opciones de primer nivel. */
  idPadre: string | null;
  titulo: string;
  icono: string | null;
  rutaPantalla: string | null;
  orden: number;
}

/**
 * Menú del usuario del token. Reemplaza al que servía el sync del microservicio.
 * El token va explícito porque se pide en el login, antes de que el interceptor
 * tenga el JWT en SecureStore.
 */
export const getMenuApi = async (token?: string): Promise<OpcionMenuApi[]> => {
  const response = await apiClientAuth.get<unknown>('/auth/accesos/mi-menu', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const datos = extraerData<unknown>(response.data, 'Menú');
  return Array.isArray(datos) ? (datos as OpcionMenuApi[]) : [];
};

// 5. Cambiar contraseña. Operación ONLINE directa: no viaja en el sync. La sirve el
// API de auth (dueño de `auth.Usuario.clave`), no nuestro backend. El token va
// explícito porque la pantalla puede abrirse justo tras el login.
export const cambiarPasswordApi = async (
  data: CambiarPasswordPayload,
  token: string,
): Promise<{ message: string }> => {
  // Sin usuarioId: el servidor lo toma del JWT. Mandarlo no cambiaría nada, y
  // aceptarlo fue lo que permitía cambiarle la clave a otro usuario.
  const response = await apiClientAuth.post<unknown>(
    '/auth/usuarios/cambiar-clave',
    {
      claveAnterior: data.passwordActual,
      claveNueva: data.passwordNueva,
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return {
    message: extraerMensaje(response.data, 'Contraseña actualizada correctamente'),
  };
};

// 6. Eliminar registro.
export const desvincularDispositivoApi = async (): Promise<{ message: string }> => {
  const response = await apiClientAuth.post<unknown>('/devices/unenroll');
  return { message: extraerMensaje(response.data, 'Equipo desvinculado') };
};