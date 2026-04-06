import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';

// Importaciones de nuestra Clean Architecture
import { EnrollmentScreen } from './src/presentation/screens/Enrollment/EnrollmentScreen';
import { useAuthStore } from './src/presentation/store/useAuthStore';
import { database } from './src/data/local/database';

// 1. Instanciamos el QueryClient de TanStack
const queryClient = new QueryClient();


// 2. Componente Temporal para el Dashboard (Sprint 2)
const DashboardScreen = () => {
  const deviceToken = useAuthStore((state) => state.deviceToken);
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#e0f7fa' }}>
      <Text style={{ fontSize: 22, fontWeight: 'bold' }}>¡Equipo Enrolado!</Text>
      <Text style={{ marginTop: 10, color: '#006064' }}>Token Activo:</Text>
      <Text style={{ fontSize: 10, marginTop: 5 }}>{deviceToken}</Text>
    </View>
  );
};

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  
  // Extraemos las acciones y estados de nuestro Store
  const { isEnrolled, checkLocalEnrollment } = useAuthStore();

  // 3. Efecto para verificar el estado de enrolamiento al abrir la app
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const enrolledStatus = await SecureStore.getItemAsync('isEnrolled');
        const token = await SecureStore.getItemAsync('deviceToken');
        
        // Si existe el flag 'true', actualizamos el store
        if (enrolledStatus === 'true') {
          checkLocalEnrollment(true, token);
        } else {
          checkLocalEnrollment(false, null);
        }
      } catch (error) {
        console.error("Error leyendo SecureStore", error);
        checkLocalEnrollment(false, null);
      } finally {
        setIsLoading(false);
      }
    };

    checkStatus();
  }, [checkLocalEnrollment]);

  // Pantalla de carga mientras lee el SecureStore
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text>Verificando dispositivo...</Text>
      </View>
    );
  }

  // 4. Proveedor de TanStack y Lógica de Navegación Condicional
  return (
    <QueryClientProvider client={queryClient}>
      {/* Si está enrolado va al Dashboard, si no, a la pantalla de Registro */}
      {isEnrolled ? <DashboardScreen /> : <EnrollmentScreen />}
    </QueryClientProvider>
  );
}