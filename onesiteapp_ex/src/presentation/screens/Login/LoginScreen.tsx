import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Keyboard, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useMutation } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { loginApi, getPermisosApi } from '../../../data/remote/auth.api';
import { useAuthStore } from '../../store/useAuthStore';
import { authLocalService } from '../../../data/local/services/authLocalService';
import { runFullSync } from '../../../data/local/services/syncManager';

type LoginModalState = 'none' | 'syncing' | 'error';

export const LoginScreen = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [modalState, setModalState] = useState<LoginModalState>('none');
  const [errorMessage, setErrorMessage] = useState('Credenciales incorrectas');
  
  // Extraemos las funciones del store de forma segura
  const setLoggedIn = useAuthStore((state) => state.setLoggedIn);

  // --- LÓGICA DE LOGIN ---
  const loginMutation = useMutation({
    mutationFn: () => loginApi({ username, password }),
    onMutate: () => {
      Keyboard.dismiss();
      setModalState('syncing');
    },
    onSuccess: async (data) => {
      try {
        // 1. Guardar tokens de seguridad (Venían del loginApi)
        await SecureStore.setItemAsync('token_sesion', data.token_sesion);
        await SecureStore.setItemAsync('refresh_token', data.refreshToken);
        await SecureStore.setItemAsync('user_id', data.user_id.toString());

        // 2. Obtener perfil completo del servidor (NestJS)
        const perfilServidor = await getPermisosApi(data.token_sesion);
        
        console.log("📥 Perfil recibido para guardar:", perfilServidor);

        // 3. GUARDADO OFFLINE
        // Usamos los campos EXACTOS que vimos en tus logs: IdUsuario, NombreCompleto, etc.
        await authLocalService.savePerfilOffline({
          IdUsuario: data.user_id, // Usamos el ID que vino del login
          NombreCompleto: perfilServidor.NombreCompleto || username,
          RolNombre: perfilServidor.RolNombre || 'Usuario',
          Permisos: perfilServidor.Permisos || {}
        });

        // 4. ÉXITO: Cambiamos estado global y cerramos modal
        // Importante: setLoggedIn dispara el re-renderizado de App.tsx para ir al Dashboard
        setModalState('none');
        setLoggedIn(data.token_sesion, data.user_id);
        
        // 5. SINCRONIZACIÓN: En segundo plano
        runFullSync().catch((err) => console.error("Error en sincro inicial:", err));

      } catch (error) {
        console.error("❌ Error en proceso post-login:", error);
        setErrorMessage('Error al preparar la base de datos local');
        setModalState('error');
      }
    },
    onError: (error: any) => {
      console.error("❌ Error en Login:", error);
      setErrorMessage(error.response?.data?.message || 'Credenciales incorrectas');
      setModalState('error');
    },
  });

  const onPressLogin = () => {
    if (!username.trim() || !password.trim()) {
      setErrorMessage('Llene todos los campos');
      setModalState('error');
      return;
    }
    loginMutation.mutate();
  };

  // --- ELIMINADA LA FUNCIÓN handleLogin DUPLICADA QUE CAUSABA ERROR ---

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      className="flex-1 bg-[#F3F4F6]"
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} bounces={false} keyboardShouldPersistTaps="handled">
        <View className="flex-1 items-center justify-center px-6 py-10">
          
          {/* Header */}
          <View className="items-center mb-10">
            <View className="bg-[#1E3A8A] w-16 h-16 rounded-full items-center justify-center mb-2 shadow-md">
              <Feather name="user" size={32} color="white" />
            </View>
            <Text className="text-3xl font-bold">
              <Text className="text-[#F59E0B]">One</Text>
              <Text className="text-[#1E3A8A]">Site</Text>
            </Text>
            <Text className="text-gray-400 tracking-[3px] text-[10px] mt-2 font-bold uppercase">Microfinanzas</Text>
            <Text className="text-[#1E3A8A] text-2xl font-bold mt-8">Iniciar sesión</Text>
          </View>

          {/* Formulario */}
          <View className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl elevation-5">
            <View className="mb-5">
              <Text className="text-gray-600 mb-2 font-semibold ml-1">Usuario</Text>
              <TextInput
                className="bg-[#F9FAFB] border border-gray-200 rounded-2xl p-4 text-gray-800 text-base"
                placeholder="Ingrese su usuario"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
            </View>

            <View className="mb-8">
              <Text className="text-gray-600 mb-2 font-semibold ml-1">Contraseña</Text>
              <TextInput
                className="bg-[#F9FAFB] border border-gray-200 rounded-2xl p-4 text-gray-800 text-base"
                placeholder="Ingrese su contraseña"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            <TouchableOpacity 
              className={`rounded-2xl py-4 items-center shadow-lg ${username && password ? 'bg-[#1E3A8A]' : 'bg-gray-400'}`}
              onPress={onPressLogin}
              disabled={!username || !password || loginMutation.isPending}
            >
              <Text className="text-white font-bold text-lg">
                {loginMutation.isPending ? 'Validando...' : 'Ingresar'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Modal Maestro */}
      <Modal visible={modalState !== 'none'} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          {modalState === 'syncing' ? (
            <View className="bg-white w-full max-w-[280px] rounded-[40px] p-10 items-center shadow-2xl">
              <ActivityIndicator size="large" color="#1E3A8A" />
              <Text className="text-gray-700 text-lg font-bold mt-6 text-center">Iniciando sesión...</Text>
            </View>
          ) : (
            <View className="bg-white w-full max-w-[320px] rounded-[40px] p-10 items-center shadow-2xl">
              <View className="bg-[#EF4444] w-20 h-20 rounded-full items-center justify-center mb-6">
                <Feather name="x" size={48} color="white" />
              </View>
              <Text className="text-xl font-bold text-gray-800 mb-10 text-center">{errorMessage}</Text>
              <TouchableOpacity 
                className="bg-[#1E3A8A] w-full rounded-2xl py-4 items-center"
                onPress={() => setModalState('none')}
              >
                <Text className="text-white font-bold text-lg">Aceptar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};