import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Button, StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';

// Importaciones de nuestra Clean Architecture
import { EnrollmentScreen } from './src/presentation/screens/Enrollment/EnrollmentScreen';
import { LoginScreen } from './src/presentation/screens/Login/LoginScreen';
import { useAuthStore } from './src/presentation/store/useAuthStore';
import { database } from './src/data/local/database';

import { useLogout } from './src/presentation/hooks/useLogout';
// NUEVAS IMPORTACIONES DEL SPRINT 3
import { DynamicMenu } from './src/presentation/components/MenuAccordion';
import { runIncrementalSync } from './src/data/local/services/syncManager';

// 1. Instanciamos el QueryClient de TanStack
const queryClient = new QueryClient();

// Dashboard Temporal (Sprint 3 en adelante)
const DashboardScreen = () => {
  const { wipeData } = useAuthStore();
  const { executeLogout } = useLogout();
  const userId = useAuthStore((state) => state.userId);
  const [isSyncing, setIsSyncing] = useState(false);

  // Función para disparar la sincronización manualmente
  const handleSync = async () => {
    setIsSyncing(true);
    await runIncrementalSync();
    setIsSyncing(false);
  };
  // Opcional: Descomenta este useEffect si quieres que sincronice automáticamente apenas entra
  /*
  useEffect(() => {
    handleSync();
  }, []);
  */

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('token_sesion');
    await SecureStore.deleteItemAsync('user_id');
    await SecureStore.deleteItemAsync('refresh_token');
    // Para hacer logout completo temporalmente, reseteamos usando wipeData
    // (En el futuro crearemos un método solo para logout sin borrar el enrolamiento)
    wipeData(); 
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F0F4F7' }}>
      {/* Header */}
      <View style={{ padding: 20, backgroundColor: '#005b96', elevation: 5 }}>
        <Text style={{ fontSize: 20, fontWeight: 'bold', color: 'white' }}>OneSiteApp_Ex</Text>
        <Text style={{ color: '#e0e0e0' }}>Usuario ID: {userId}</Text>
      </View>

      {/* Menú Reactivo (Acordeón) */}
      <View style={{ flex: 1 }}>
        <DynamicMenu />
      </View>

      {/* Botones de Acción Fijos al pie */}
      <View style={{ padding: 20, borderTopWidth: 1, borderColor: '#ccc', backgroundColor: 'white' }}>
        <View style={{ marginBottom: 10 }}>
          <Button 
            title={isSyncing ? "Sincronizando..." : "🔄 Sincronizar Datos"} 
            onPress={handleSync} 
            disabled={isSyncing}
            color="#4CAF50" 
          />
        </View>
        <Button 
          title="Cerrar Sesión" 
          onPress={executeLogout} 
          color="#E53935" 
        />
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

 const styles = StyleSheet.create({
  dashboardContainer: { flex: 1, backgroundColor: '#f4f6f8' },
  header: { padding: 20, backgroundColor: '#ffffff', elevation: 4, marginBottom: 10 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  headerSubtitle: { color: '#666', marginBottom: 15 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-start' }
});
