import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, Platform, TouchableOpacity, Modal, ActivityIndicator, ScrollView, Keyboard, KeyboardAvoidingView} from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { useMutation } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons'; // Iconos para los modales

import { enrollDeviceApi, updateMetadataApi } from '../../../data/remote/auth.api';
import { useAuthStore } from '../../store/useAuthStore';

// Unificamos el estado del Modal igual que en el Login
type EnrollmentModalState = 'none' | 'success' | 'error';

// Tipado para manejar el estado del Modal
type ModalState = {
  visible: boolean;
  type: 'success' | 'error' | null;
  message: string;
};
export const EnrollmentScreen = () => {
  const [companyCode, setCompanyCode] = useState('');
  
  const [modalState, setModalState] = useState<EnrollmentModalState>('none');
  const [modalMessage, setModalMessage] = useState('');
  
  const setEnrollment = useAuthStore((state) => state.setEnrollment);

  const enrollMutation = useMutation({
    mutationFn: enrollDeviceApi,
    onMutate: () => {
      // ¡CRÍTICO PARA ANDROID! Ocultar teclado antes de cualquier Modal
      Keyboard.dismiss();
    },
    onSuccess: async (data) => {
      try {
        await SecureStore.setItemAsync('deviceToken', data.deviceToken);
        await SecureStore.setItemAsync('isEnrolled', 'true');
        
        setModalMessage('Bienvenido');
        setModalState('success');

        updateMetadataApi({
          deviceToken: data.deviceToken,
          modelo: Device.modelName || 'Unknown',
          versionSO: `${Platform.OS} ${Device.osVersion}`
        }).catch(console.warn);
        
      } catch (error) {
        setModalMessage('Error al guardar datos locales');
        setModalState('error');
      }
    },
    onError: (error: any) => {
      // Ahora el interceptor dejará llegar el error hasta aquí
      setModalMessage(error.response?.data?.message || 'Código Inválido');
      setModalState('error');
    },
  });

  const handleEnroll = async () => {
    if (companyCode.length < 5) {
      setModalMessage('El código es muy corto');
      setModalState('error');
      return;
    }
    
    let hardwareId = Platform.OS === 'android' 
      ? Application.getAndroidId() 
      : (await Application.getIosIdForVendorAsync() ?? 'ID_UNKNOWN');

    enrollMutation.mutate({ codigoEnrolamiento: companyCode, hardwareId });
  };

  const handleAccept = () => {
    const isSuccess = modalState === 'success';
    setModalState('none');
    
    if (isSuccess) {
      // Pequeño delay para que el Modal desaparezca fluidamente antes de cambiar de pantalla
      setTimeout(() => {
        SecureStore.getItemAsync('deviceToken').then(token => {
          if (token) setEnrollment(token);
        });
      }, 300);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1 bg-gray-100">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} bounces={false} keyboardShouldPersistTaps="handled">
        <View className="flex-1 items-center justify-center px-6 py-10">
          
          <View className="items-center mb-12">
            <View className="bg-[#1E3A8A] w-20 h-20 rounded-full items-center justify-center mb-4 shadow-lg">
              <Feather name="user" size={40} color="white" />
            </View>
            <Text className="text-3xl font-bold tracking-tighter">
              <Text className="text-[#F59E0B]">One</Text>
              <Text className="text-[#1E3A8A]">Site</Text>
            </Text>
            <Text className="text-gray-400 tracking-[4px] text-[10px] mt-2 font-bold">MICROFINANZAS</Text>
            <Text className="text-[#1E3A8A] text-2xl font-bold mt-6">Bienvenido</Text>
          </View>

          <View className="bg-white w-full max-w-sm rounded-3xl p-8 shadow-xl">
            <Text className="text-center text-gray-500 mb-6 text-sm font-medium">
              Ingrese el código para registrar su dispositivo
            </Text>
            
            <TextInput
              className="border border-gray-200 rounded-2xl p-4 text-center text-lg bg-gray-50 mb-6 font-semibold"
              placeholder="Código"
              value={companyCode}
              onChangeText={setCompanyCode}
              autoCapitalize="characters"
            />

            <TouchableOpacity 
              className="bg-[#1E3A8A] rounded-2xl py-4 items-center shadow-md active:bg-[#162d6b]"
              onPress={handleEnroll}
              disabled={enrollMutation.isPending}
            >
              {enrollMutation.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-bold text-lg">Registrar</Text>
              )}
            </TouchableOpacity>
          </View>

        </View>
      </ScrollView>

      {/* --- UN SOLO MODAL DE RESULTADO --- */}
      <Modal visible={modalState !== 'none'} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-xs rounded-[40px] p-10 items-center shadow-2xl">
            
            <View 
              style={{ backgroundColor: modalState === 'success' ? '#1E3A8A' : '#EF4444' }}
              className="w-24 h-24 rounded-full items-center justify-center mb-8"
            >
              <Feather name={modalState === 'success' ? "check" : "x"} size={50} color="white" />
            </View>

            <Text className="text-2xl font-bold text-gray-800 mb-10 text-center">
              {modalMessage}
            </Text>

            <TouchableOpacity 
              style={{ backgroundColor: '#1E3A8A' }}
              className="w-full rounded-2xl py-4 items-center shadow-lg"
              onPress={handleAccept}
            >
              <Text className="text-white font-bold text-xl">Aceptar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
};
