import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { useAuthStore } from '../../presentation/store/useAuthStore';

// Usamos la variable de entorno 
const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

export const apiClient = axios.create({
  baseURL,
  timeout: 10000,
});

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

// INTERCEPTOR DE RESPUESTA (Response) - CUMPLIMIENTO REGLA 4.3
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {

    const deviceToken = await SecureStore.getItemAsync('deviceToken');
    const sessionToken = await SecureStore.getItemAsync('token_sesion');

    if (!error.headers) {
      error.headers = {} as any;
    }
    // Inyectamos el DeviceToken en el Header personalizado
    if (deviceToken) {
      error.headers['x-device-token'] = deviceToken;
    }
    
    // Inyectamos el JWT de sesión
    if (sessionToken) {
      error.headers.Authorization = `Bearer ${sessionToken}`;
    }

    // LOGS ESTRATÉGICOS
    console.log(`📡 [NETWORK] Petición a: ${error.url}`);
    if (deviceToken) console.log(`🔑 [HEADER INYECTADO] x-device-token: ${deviceToken.substring(0, 8)}...`);
    if (sessionToken) console.log(`🔒 [HEADER INYECTADO] Authorization: Bearer ${sessionToken.substring(0, 15)}...`);

    if (deviceToken) error.headers['x-device-token'] = deviceToken;
    if (sessionToken) error.headers['Authorization'] = `Bearer ${sessionToken}`;

    if (error.response && error.response.status === 403) {
      console.warn("Dispositivo bloqueado detectado (403). Ejecutando purga...");
      
      // 1. Limpiar SecureStore
      await SecureStore.deleteItemAsync('deviceToken');
      await SecureStore.deleteItemAsync('isEnrolled');
      await SecureStore.deleteItemAsync('token_sesion');
      await SecureStore.deleteItemAsync('user_id');
      await SecureStore.deleteItemAsync('companyName');

      // 2. Limpiar Memoria Global (Zustand)
      useAuthStore.getState().wipeData();

      // 3. Notificar al usuario (La app volverá automáticamente a Fase 1)
      Alert.alert(
        'Acceso Denegado', 
        'Este dispositivo ha sido bloqueado o desvinculado por el administrador. Contacte a soporte técnico.'
      );
    }
    return Promise.reject(error);
  }
  
);