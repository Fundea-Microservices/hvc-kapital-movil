import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { apiClient } from './src/core/network/apiClient';
import "./global.css";

import { EnrollmentScreen } from './src/presentation/screens/Enrollment/EnrollmentScreen';
import { LoginScreen } from './src/presentation/screens/Login/LoginScreen';
import { useAuthStore } from './src/presentation/store/useAuthStore'; 
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { DashboardScreen } from './src/presentation/screens/Dashboard/DashboardScreen';
import { DynamicSurveyScreen } from './src/presentation/screens/DynamicSurvey/DynamicSurveyScreen'; 

const queryClient = new QueryClient();
const Stack = createNativeStackNavigator();


export default function App() {
  // 1. Usamos checkLocalState para actualizar TODO de un solo golpe
  const { isLoggedIn, isEnrolled, checkLocalState } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  
  //const [viewState, setViewState] = useState<{ name: 'DASHBOARD' | 'SURVEY', params?: string }>({ name: 'DASHBOARD' });

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Validar versión (Opcional)
        const appVersion = Application.nativeApplicationVersion || '1.0.0';
        await apiClient.get(`/devices/version?appVersion=${appVersion}`).catch(() => {});
        
        // 2. LEER TODA LA PERSISTENCIA
        const enrolledStatus = await SecureStore.getItemAsync('isEnrolled');
        const deviceToken = await SecureStore.getItemAsync('deviceToken');
        const sessionToken = await SecureStore.getItemAsync('token_sesion');
        const userIdRaw = await SecureStore.getItemAsync('user_id');
        
        // Convertir valores para el Store
        const isAppEnrolled = enrolledStatus === 'true';
        const isUserLoggedIn = !!sessionToken;
        const userId = userIdRaw ? parseInt(userIdRaw, 10) : null;
        const userName = await SecureStore.getItemAsync('user_name');

        // 3. ACTUALIZACIÓN ÚNICA (Evita errores de orden de Hooks)
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

  /**const renderRouter = () => {
    if (!isEnrolled) return <EnrollmentScreen />;
    if (!isLoggedIn) return <LoginScreen />;

    if (viewState.name === 'SURVEY' && viewState.params) {
      return (
        <DynamicSurveyScreen 
          idEncuesta={viewState.params} 
          onVolverInicio={() => setViewState({ name: 'DASHBOARD' })} 
        />
      );
    }
    return (
      <DashboardScreen 
        onAbrirEncuesta={(id: string) => setViewState({ name: 'SURVEY', params: id })} 
      />
    );
  };**/

  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center bg-[#f4f6f8]">
        <ActivityIndicator size="large" color="#1E3A8A" />
        <Text className="mt-4 text-gray-500 font-bold">Verificando seguridad...</Text>
      </View>
    );
  };
  
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!isEnrolled ? (
            // FLUJO 1: Registro de dispositivo
            <Stack.Screen name="Enrollment" component={EnrollmentScreen} />
          ) : !isLoggedIn ? (
            // FLUJO 2: Autenticación
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : (
            // FLUJO 3: App Principal (Dashboard y Encuestas)
            <>
              <Stack.Screen name="Dashboard" component={DashboardScreen} />
              <Stack.Screen name="DynamicSurvey" component={DynamicSurveyScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>
  );
}