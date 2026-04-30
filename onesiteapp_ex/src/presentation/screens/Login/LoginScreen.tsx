import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, TouchableOpacity, Modal, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Keyboard } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useMutation } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { loginApi, getPermisosApi } from '../../../data/remote/auth.api';
import { saveUserProfileLocal } from '../../../data/local/services/user.service';
import { useAuthStore } from '../../store/useAuthStore';

// Unificamos el estado del Modal
type LoginModalState = 'none' | 'syncing' | 'error';

export const LoginScreen = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Estados para los Modales de los Mockups
 // Estado único para controlar la UI del modal
  const [modalState, setModalState] = useState<LoginModalState>('none');
  const [errorMessage, setErrorMessage] = useState('Credenciales incorrectas');
  
  const setLogin = useAuthStore((state) => state.setLogin);
  const loginMutation = useMutation({
    mutationFn: loginApi,
    onMutate: () => {
      Keyboard.dismiss(); // Escondemos el teclado para evitar bugs gráficos en Android
      setModalState('syncing');
    },
    onSuccess: async (data) => {
      try {
        await SecureStore.setItemAsync('token_sesion', data.token_sesion);
        await SecureStore.setItemAsync('refresh_token', data.refreshToken);
        await SecureStore.setItemAsync('user_id', data.user_id.toString());

        const perfil = await getPermisosApi(data.token_sesion);
        
        await saveUserProfileLocal({
          id_usuario: data.user_id,
          nombre: username,
          rol: perfil.rol,
          permisos: perfil.permisosGranulares
        });

        setModalState('none');
        setLogin(data.token_sesion, data.user_id);
      } catch (error) {
        setErrorMessage('Error al guardar el perfil offline');
        setModalState('error');
      }
    },
    onError: (error: any) => {
      if (error.response?.status !== 403) {
        // Obtenemos el mensaje exacto del backend o usamos uno por defecto
        setErrorMessage(error.response?.data?.message || 'Credenciales incorrectas');
        setModalState('error');
      } else {
         setModalState('none'); // Si es 403, el interceptor ya está haciendo el Wipe
      }
    },
  });

  const handleLogin = () => {
    if (username.length > 0 && password.length > 0) {
      loginMutation.mutate({ username, password });
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1 bg-[#F3F4F6]">
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
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <TouchableOpacity 
              className="bg-[#1E3A8A] rounded-2xl py-4 items-center shadow-lg active:opacity-90"
              onPress={handleLogin}
              disabled={username.length === 0 || password.length === 0}
            >
              <Text className="text-white font-bold text-lg">Ingresar</Text>
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>

      {/* --- UN SOLO MODAL MAESTRO --- */}
      <Modal visible={modalState !== 'none'} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          
          {modalState === 'syncing' ? (
            // UI DE SINCRONIZACIÓN
            <View className="bg-white w-full max-w-[280px] rounded-[40px] p-10 items-center shadow-2xl">
              <ActivityIndicator size="large" color="#1E3A8A" />
              <Text className="text-gray-700 text-lg font-bold mt-6 text-center">Sincronizando datos...</Text>
            </View>
          ) : (
            // UI DE ERROR
            <View className="bg-white w-full max-w-[320px] rounded-[40px] p-10 items-center shadow-2xl">
              <View className="bg-[#EF4444] w-20 h-20 rounded-full items-center justify-center mb-6">
                <Feather name="x" size={48} color="white" />
              </View>
              <Text className="text-xl font-bold text-gray-800 mb-10 text-center">
                {errorMessage}
              </Text>
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
