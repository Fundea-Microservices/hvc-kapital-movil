import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Button, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
import { apiClient } from './src/core/network/apiClient';
import "./global.css";
// Importaciones de nuestra Clean Architecture
import { EnrollmentScreen } from './src/presentation/screens/Enrollment/EnrollmentScreen';
import { LoginScreen } from './src/presentation/screens/Login/LoginScreen';
import { useAuthStore } from './src/presentation/store/useAuthStore';
import { DashboardScreen } from './src/presentation/screens/Dashboard/DashboardScreen';

import { database } from './src/data/local/database';
import { useLogout } from './src/presentation/hooks/useLogout';
// NUEVAS IMPORTACIONES DEL SPRINT 3
import { DynamicMenu } from './src/presentation/components/MenuAccordion';
import { runIncrementalSync } from './src/data/local/services/syncManager';
import { SurveyFormScreen } from './src/presentation/components/Surveys/SurveyFormScreen';

// 1. Instanciamos el QueryClient de TanStack
const queryClient = new QueryClient();

// Dashboard Temporal (Sprint 3 en adelante)

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const { isEnrolled, isLoggedIn, checkLocalState } = useAuthStore();

  useEffect(() => {
    const checkStatus = async () => {
      try {
        //2 lineas siguientes Sprint 4
        const appVersion = Application.nativeApplicationVersion || '1.0.0';
        await apiClient.get(`/devices/version?appVersion=${appVersion}`);
        // Leer estado de la memoria
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
        <SurveyFormScreen />
      )}
    </QueryClientProvider>
  );

}

 const styles = StyleSheet.create({
  dashboardContainer: { flex: 1, backgroundColor: '#f4f6f8' },
  header: { padding: 20, backgroundColor: '#ffffff', elevation: 4, marginBottom: 10 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  headerSubtitle: { color: '#666', marginBottom: 15 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-start' }
});
