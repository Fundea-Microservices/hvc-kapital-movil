import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useMutation } from '@tanstack/react-query';
import { loginApi, getPermisosApi } from '../../../data/remote/auth.api';
import { useAuthStore } from '../../store/useAuthStore';
import { saveUserProfileLocal } from '../../../data/local/services/user.service';

export const LoginScreen = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const setLogin = useAuthStore((state) => state.setLogin);

  const loginMutation = useMutation({
    mutationFn: loginApi,
    onSuccess: async (data) => {
      try {
        // 1. Guardar tokens en almacenamiento seguro (Regla 2.3)
        await SecureStore.setItemAsync('token_sesion', data.token_sesion);
        await SecureStore.setItemAsync('refresh_token', data.refreshToken);
        await SecureStore.setItemAsync('user_id', data.user_id.toString());

        // 2. OBTENER PERMISOS DEL SERVIDOR (Nuevo)
        // Pasamos el token recién obtenido directamente a la función
        const perfilSrv = await getPermisosApi(data.token_sesion);

        // 3. PERSISTENCIA EN SQLITE (WatermelonDB)
      await saveUserProfileLocal({
      id_usuario: data.user_id,
      nombre: "Juan Demo", // Pendiente: Traer nombre del backend en el futuro
      rol: perfilSrv.rol,
      permisos: perfilSrv.permisosGranulares
      });
        
        // . Actualizar estado global para pasar al Dashboard
        setLogin(data.token_sesion, data.user_id);
        
      } catch (error) {
        console.error("Error detallado en la sincronización local:", error);
        Alert.alert('Error Local', 'Sesión iniciada pero no se pudo sincronizar el perfil local.');
      }
      console.log('[LOGIN SUCCESS] Tokens recibidos del servidor.');
    },
    onError: (error: any) => {
      
      // El 403 lo maneja el Interceptor automáticamente, aquí manejamos 401 (Credenciales)
      if (error.response?.status !== 403) {
        const errorMsg = error.response?.data?.message || 'Error al iniciar sesión.';
        Alert.alert('Error', errorMsg);
      }
    },

    
    
  });

  const handleLogin = () => {
    if (username.length < 3 || password.length < 6) {
      Alert.alert('Validación', 'Por favor ingrese un usuario y contraseña válidos.');
      return;
    }

    // El x-device-token se inyecta mágicamente por nuestro apiClient
    loginMutation.mutate({ username, password });

    console.log(`👤 [LOGIN START] Intentando loguear usuario: ${username}`);
    loginMutation.mutate({ username, password });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Iniciar Sesión</Text>
      <Text style={styles.subtitle}>Ingrese sus credenciales para continuar.</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Usuario (ej. usuario.demo)"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        editable={!loginMutation.isPending}
      />

      <TextInput
        style={styles.input}
        placeholder="Contraseña"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loginMutation.isPending}
      />

      <Button 
        title={loginMutation.isPending ? "Autenticando..." : "Ingresar"} 
        onPress={handleLogin} 
        disabled={loginMutation.isPending || username.length === 0 || password.length === 0}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#F5F5F5' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 10, textAlign: 'center', color: '#333' },
  subtitle: { fontSize: 16, marginBottom: 30, textAlign: 'center', color: '#666' },
  input: { borderWidth: 1, borderColor: '#CCC', padding: 15, borderRadius: 8, marginBottom: 20, backgroundColor: '#FFF', fontSize: 16 },
});