import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Button } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';

// Importaciones de nuestra Clean Architecture
import { EnrollmentScreen } from './src/presentation/screens/Enrollment/EnrollmentScreen';
import { LoginScreen } from './src/presentation/screens/Login/LoginScreen';
import { useAuthStore } from './src/presentation/store/useAuthStore';
import { database } from './src/data/local/database';

import { useLogout } from './src/presentation/hooks/useLogout';
// 1. Instanciamos el QueryClient de TanStack
const queryClient = new QueryClient();

// Dashboard Temporal (Sprint 3 en adelante)
const DashboardScreen = () => {
  const { wipeData } = useAuthStore();
  const { executeLogout } = useLogout();
  const userId = useAuthStore((state) => state.userId);
  

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('token_sesion');
    await SecureStore.deleteItemAsync('user_id');
    await SecureStore.deleteItemAsync('refresh_token');
    // Para hacer logout completo temporalmente, reseteamos usando wipeData
    // (En el futuro crearemos un método solo para logout sin borrar el enrolamiento)
    wipeData(); 
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F0F4F7' }}>
      <View style={{ padding: 20, backgroundColor: 'white', borderRadius: 15, elevation: 5, alignItems: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: 'bold', color: '#333' }}>Dashboard Principal</Text>
        <Text style={{ marginTop: 10, color: '#666' }}>ID de Sesión: {userId}</Text>
        
        <View style={{ marginTop: 30, width: 200 }}>
          <Button 
            title="Cerrar Sesión" 
            onPress={executeLogout} 
            color="#E53935" 
          />
        </View>
      </View>
    </View>
  );
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const { isEnrolled, isLoggedIn, checkLocalState } = useAuthStore();

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const enrolledStatus = await SecureStore.getItemAsync('isEnrolled');
        const deviceToken = await SecureStore.getItemAsync('deviceToken');
        const sessionToken = await SecureStore.getItemAsync('token_sesion');
        const userIdRaw = await SecureStore.getItemAsync('user_id');
        
        const isAppEnrolled = enrolledStatus === 'true';
        const isUserLoggedIn = !!sessionToken;
        const userId = userIdRaw ? parseInt(userIdRaw, 10) : null;

        checkLocalState(isAppEnrolled, deviceToken, isUserLoggedIn, sessionToken, userId);
      } catch (error) {
        console.error("Error leyendo SecureStore", error);
        checkLocalState(false, null, false, null, null);
      } finally {
        setIsLoading(false);
      }
    };

    checkStatus();
  }, [checkLocalState]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={{ marginTop: 10 }}>Verificando seguridad...</Text>
      </View>
    );
  }

  // ÁRBOL DE DECISIÓN (Flujo 1 y Flujo 2)
  return (
    <QueryClientProvider client={queryClient}>
      {!isEnrolled ? (
        <EnrollmentScreen />
      ) : !isLoggedIn ? (
        <LoginScreen />
      ) : (
        <DashboardScreen />
      )}
    </QueryClientProvider>
  );
}

