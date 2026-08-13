import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { apiClient } from './src/core/network/apiClient';
import { SyncOnReconnect } from './src/presentation/components/SyncOnReconnect';
import { registrarError } from './src/data/local/services/bitacora.service';
import "./global.css";

import { EnrollmentScreen } from './src/presentation/screens/Enrollment/EnrollmentScreen';
import { LoginScreen } from './src/presentation/screens/Login/LoginScreen';
import { useAuthStore } from './src/presentation/store/useAuthStore'; 
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DashboardScreen } from './src/presentation/screens/Dashboard/DashboardScreen';
import { DynamicSurveyScreen } from './src/presentation/screens/DynamicSurvey/DynamicSurveyScreen'; 
import { SurveyClientsScreen } from './src/presentation/screens/Surveys/SurveyClientsScreen';

const queryClient = new QueryClient();
const Stack = createNativeStackNavigator();

/**
 * Captura los errores que NADIE atrapó y los deja en la bitácora local.
 *
 * Los `try/catch` cubren lo que se previó que podía fallar; esto cubre el resto —un
 * `undefined` inesperado en un render, una promesa sin `catch`— que es justo lo que
 * hace que la aplicación se cierre en campo sin dejar rastro.
 *
 * Se instala FUERA del componente para que ocurra una sola vez, no en cada render.
 * El manejador anterior se conserva y se invoca al final: sustituirlo sin más
 * desactivaría la pantalla roja de error en desarrollo.
 */
const instalarCapturaGlobal = (): void => {
  const global = globalThis as {
    ErrorUtils?: {
      getGlobalHandler: () => (error: Error, esFatal?: boolean) => void;
      setGlobalHandler: (manejador: (error: Error, esFatal?: boolean) => void) => void;
    };
  };
  if (!global.ErrorUtils) return;

  const anterior = global.ErrorUtils.getGlobalHandler();

  global.ErrorUtils.setGlobalHandler((error, esFatal) => {
    // El registro es asíncrono y el proceso puede morir enseguida si el error es
    // fatal: se lanza sin esperar y con su propio catch, porque fallar aquí no debe
    // impedir que el manejador original haga su trabajo.
    void registrarError('app.errorNoCapturado', error, { fatal: !!esFatal }).catch(() => {});
    anterior(error, esFatal);
  });
};

instalarCapturaGlobal();

export default function App() {
  const { isLoggedIn, isEnrolled, checkLocalState } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false); // Ponlo en true si tu lógica de carga inicial es pesada

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const appVersion = Application.nativeApplicationVersion || '1.0.0';
        await apiClient.get(`/devices/version?appVersion=${appVersion}`).catch(() => {});
        
        const enrolledStatus = await SecureStore.getItemAsync('isEnrolled');
        const deviceToken = await SecureStore.getItemAsync('deviceToken');
        const sessionToken = await SecureStore.getItemAsync('token_sesion');
        const userIdRaw = await SecureStore.getItemAsync('user_id');
        
        const isAppEnrolled = enrolledStatus === 'true';
        const isUserLoggedIn = !!sessionToken;
        const userId = userIdRaw ? parseInt(userIdRaw, 10) : null;
        const userName = await SecureStore.getItemAsync('user_name');

        checkLocalState(
          isAppEnrolled, 
          deviceToken, 
          isUserLoggedIn, 
          sessionToken, 
          userId,
          userName
        );

      } catch (error) {
        console.error("❌ Error en inicialización de App:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeApp();
  }, [checkLocalState]);

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-[#f4f6f8]">
        <ActivityIndicator size="large" color="#1E3A8A" />
        <Text className="mt-4 text-gray-500 font-bold">Verificando seguridad...</Text>
      </View>
    );
  }
  
  //  Se usan Stack.Group para manejar la condicionalidad sin romper el árbol
  return (
    <QueryClientProvider client={queryClient}>
      {/* Reintento de sincronización al recuperar señal. Debe ir dentro del
          proveedor de TanStack Query porque consume useSyncMutation. */}
      <SyncOnReconnect />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          
          {!isEnrolled ? (
            // FLUJO 1: Registro de dispositivo
            <Stack.Group>
              <Stack.Screen name="Enrollment" component={EnrollmentScreen} />
            </Stack.Group>
          ) : !isLoggedIn ? (
            // FLUJO 2: Autenticación
            <Stack.Group>
              <Stack.Screen name="Login" component={LoginScreen} />
            </Stack.Group>
          ) : (
            // FLUJO 3: App Principal (Agrupadas sin Fragmentos puros)
            <Stack.Group>
              <Stack.Screen name="Dashboard" component={DashboardScreen} />
              <Stack.Screen name="SurveyClients" component={SurveyClientsScreen} />
              <Stack.Screen name="DynamicSurvey" component={DynamicSurveyScreen} />
            </Stack.Group>
          )}

        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}