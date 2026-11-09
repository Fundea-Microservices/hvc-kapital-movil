import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Image, Alert, Platform, TouchableOpacity, Modal, ActivityIndicator, ScrollView, Keyboard, KeyboardAvoidingView } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { useMutation } from '@tanstack/react-query';
import { Check, HelpCircle, Info, KeyRound, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enrollDeviceApi, updateMetadataApi } from '../../../data/remote/auth.api';
import { useAuthStore } from '../../store/useAuthStore';
import { mensajeDeError } from '../../../data/remote/types/sync.types';
import { COLORES } from '../../theme/colores';

// Estado del Modal unificado igual que en el Login. 'info' es neutro: ni éxito ni
// fallo, para avisos como el del reenvío de código.
type EnrollmentModalState = 'none' | 'success' | 'error' | 'info';

/** Segundos que el enlace de reenvío permanece bloqueado tras abrir la pantalla. */
const ESPERA_REENVIO_SEGUNDOS = 30;

export const EnrollmentScreen = () => {
  const [companyCode, setCompanyCode] = useState('');
  const [campoEnfocado, setCampoEnfocado] = useState(false);
  const insets = useSafeAreaInsets();

  const [modalState, setModalState] = useState<EnrollmentModalState>('none');
  const [modalMessage, setModalMessage] = useState('');

  // Cuenta atrás del reenvío. El clearInterval es obligatorio: sin él, salir de la
  // pantalla deja el temporizador vivo haciendo setState sobre un componente muerto.
  const [segundosRestantes, setSegundosRestantes] = useState(ESPERA_REENVIO_SEGUNDOS);

  useEffect(() => {
    if (segundosRestantes <= 0) return;
    const intervalo = setInterval(() => {
      setSegundosRestantes((previo) => (previo > 0 ? previo - 1 : 0));
    }, 1000);
    return () => clearInterval(intervalo);
  }, [segundosRestantes]);

  const setEnrolled = useAuthStore((state) => state.setEnrolled);

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
        // Regla 1.3 del Anexo 1: persistir el nombre de la empresa para mostrarlo en la UI.
        if (data.companyName) {
          await SecureStore.setItemAsync('company_name', String(data.companyName));
        }

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
    onError: (error: unknown) => {
      // Ahora el interceptor dejará llegar el error hasta aquí
      setModalMessage(mensajeDeError(error, 'Código Inválido'));
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

  // No hay endpoint de reenvío: el código lo emite el administrador. Decirlo es lo
  // único honesto que puede hacer el enlace en vez de quedar como botón muerto.
  const handleReenviar = () => {
    if (segundosRestantes > 0) return;
    Keyboard.dismiss();
    setModalMessage('solicitando un código nuevo');
    setModalState('info');
    setSegundosRestantes(ESPERA_REENVIO_SEGUNDOS);
  };

  const handleAccept = () => {
    const isSuccess = modalState === 'success';
    setModalState('none');

    if (isSuccess) {
      // Pequeño delay para que el Modal desaparezca fluidamente antes de cambiar de pantalla
      setTimeout(() => {
        SecureStore.getItemAsync('deviceToken').then(token => {
          if (token) setEnrolled(token);
        });
      }, 300);
    }
  };

  const colorDelModal = modalState === 'error' ? COLORES.error : COLORES.navy;
  const IconoDelModal = modalState === 'success' ? Check : modalState === 'error' ? X : Info;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1 bg-brand-light">
      {/* Cabecera de marca: logo sobre blanco, separado por una línea sutil. */}
      <View className="bg-white pb-5 items-center border-b border-gray-100" style={{ paddingTop: insets.top + 16 }}>
        <Image
          source={require('../../../../assets/logo-hvc.png')}
          style={{ width: 230, height: 90}}
          resizeMode="stretch"
        />
      </View>

      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-7 py-10">
          <Text className="text-[26px] font-inter-bold text-brand-blue text-center">
            Verificación de Seguridad
          </Text>
          <Text className="text-brand-steel text-base font-sans text-center mt-2 mb-8">
            Ingresa el código de acceso{'\n'}recibido por SMS
          </Text>

          {/* Borde en reposo gris, en foco naranja (guía de componentes). */}
          <View
            className="flex-row items-center border-2 rounded-input px-4 bg-white"
            style={{ borderColor: campoEnfocado ? COLORES.orange : COLORES.gray }}
          >
            <KeyRound size={20} color={campoEnfocado ? COLORES.orange : COLORES.gray} />
            <TextInput
              className="flex-1 py-4 px-3 text-lg font-inter-semibold text-brand-navy"
              value={companyCode}
              onChangeText={setCompanyCode}
              onFocus={() => setCampoEnfocado(true)}
              onBlur={() => setCampoEnfocado(false)}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={handleEnroll}
            />
          </View>

          <TouchableOpacity
            className="bg-brand-navy rounded-cta py-4 items-center shadow-md mt-5"
            onPress={handleEnroll}
            disabled={enrollMutation.isPending}
          >
            {enrollMutation.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-inter-semibold text-lg">Continuar</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            className="items-center mt-7"
            onPress={handleReenviar}
            disabled={segundosRestantes > 0}
          >
            <Text className="text-brand-mist text-sm font-sans">
              {segundosRestantes > 0
                ? `Reenviar código (disponible en ${segundosRestantes}s)`
                : 'Reenviar código'}
            </Text>
          </TouchableOpacity>

          <View className="items-center mt-6">
            <TouchableOpacity
              onPress={() =>
                Alert.alert(
                  'Código de acceso',
                  'El administrador le entrega el código que registra este equipo. Si no lo tiene, solicítelo antes de continuar.',
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Ayuda sobre el código de acceso"
            >
              <HelpCircle size={26} color={COLORES.mist} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* --- UN SOLO MODAL DE RESULTADO --- */}
      <Modal visible={modalState !== 'none'} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-xs rounded-[40px] p-10 items-center shadow-2xl">

            <View
              style={{ backgroundColor: colorDelModal }}
              className="w-24 h-24 rounded-full items-center justify-center mb-8"
            >
              <IconoDelModal size={46} color="white" />
            </View>

            <Text className="text-2xl font-inter-bold text-brand-blue mb-10 text-center">
              {modalMessage}
            </Text>

            <TouchableOpacity
              className="w-full bg-brand-navy rounded-cta py-4 items-center shadow-lg"
              onPress={handleAccept}
            >
              <Text className="text-white font-inter-semibold text-xl">Aceptar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
};
