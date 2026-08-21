import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator, Platform, ScrollView, Keyboard, Alert, Image, TouchableWithoutFeedback } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useMutation } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

import { Q } from '@nozbe/watermelondb';

import { loginApi, getPermisosApi } from '../../../data/remote/auth.api';
import { useAuthStore } from '../../store/useAuthStore';
import { authLocalService } from '../../../data/local/services/authLocalService';
import { runFullSync } from '../../../data/local/services/syncManager';
import { mensajeDeError } from '../../../data/remote/types/sync.types';
import { useUnenroll } from '../../hooks/useUnenroll';
import { DesvincularModal } from '../../components/DesvincularModal';
import { contarPendientesDeSubida } from '../../../data/local/services/multimedia.service';
import { database } from '../../../data/local/database';

type LoginModalState = 'none' | 'syncing' | 'error';

export const LoginScreen = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [modalState, setModalState] = useState<LoginModalState>('none');
  const [errorMessage, setErrorMessage] = useState('Credenciales incorrectas');

  // Desvinculación del dispositivo desde el Login (sin sesión, sin contraseña).
  const { executeUnenroll } = useUnenroll();
  const [isUnenrollOpen, setIsUnenrollOpen] = useState(false);
  const [unenrollError, setUnenrollError] = useState('');
  const [unenrollLoading, setUnenrollLoading] = useState(false);
  const [capturasSinSubir, setCapturasSinSubir] = useState(0);
  const [pendientesMultimedia, setPendientesMultimedia] = useState(0);

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
        await SecureStore.setItemAsync('user_id', String(data.user_id)) //debeir como String
        await SecureStore.setItemAsync('user_name', username.trim()); // Handle de login para mostrarlo en el Dashboard

        // Bandera de primer ingreso. Se persiste en SecureStore para que sobreviva a un
        // reinicio antes de cambiar la contraseña: App.tsx la rehidrata al arrancar y el
        // gate vuelve a forzar el cambio en lugar de dejar entrar al Dashboard.
        const debeCambiarPassword = !!data.requiereCambioPassword;
        await SecureStore.setItemAsync('requiere_cambio_password', String(debeCambiarPassword));

        // 2. Obtener perfil completo del servidor (NestJS)
        const perfilServidor = await getPermisosApi(data.token_sesion);
        // El nombre viene en la respuesta de LOGIN (data.nombrecompleto), no en /auth/permisos.
        const nombreParaMostrar = data.nombrecompleto || perfilServidor.NombreCompleto || perfilServidor.nombreCompleto || username.trim();
        await SecureStore.setItemAsync('nombre_completo', String(nombreParaMostrar));

        // 3. GUARDADO OFFLINE
        // Usamos los campos EXACTOS que vimos en tus logs: IdUsuario, NombreCompleto, etc.
        await authLocalService.savePerfilOffline({
          IdUsuario: data.user_id, // Usamos el ID que vino del login
          NombreCompleto: nombreParaMostrar || username,
          // El backend devuelve la llave en minúscula ('rol'); leerla como 'Rol'
          // guardaba siempre el valor por defecto.
          RolNombre: perfilServidor.rol || 'Usuario',
          // FIX: WatermelonDB/LocalService puede ahogarse si le pasamos un JSON anidado. Lo serializamos a string para evitar errores de tipo.
          Permisos: typeof perfilServidor.permisosGranulares === 'string'
            ? perfilServidor.permisosGranulares
            : JSON.stringify(perfilServidor.permisosGranulares || {})
        });

        // 4. ÉXITO: Cambiamos estado global y cerramos modal
        // Importante: setLoggedIn dispara el re-renderizado de App.tsx. Si debeCambiarPassword
        // es true, el gate muestra la pantalla de cambio de contraseña, NO el Dashboard.
        setModalState('none');
        setLoggedIn(data.token_sesion, data.user_id, nombreParaMostrar, debeCambiarPassword);

        // 5. SINCRONIZACIÓN: En segundo plano.
        // NO encadenar sincronizarCatalogos() aquí: runFullSync() ya lo ejecuta y,
        // acto seguido, sincronizarCatalogosApi(). Volver a llamarlo al final
        // purgaba local_catalogo_opciones y borraba las filas API_* recién
        // guardadas, dejando los selects de origen API vacíos.
        runFullSync()
          .catch((err) => console.error("Error en sincro general:", err));
      } catch (error) {
        console.error("❌ Error en proceso post-login:", error);
        setErrorMessage('Error al preparar la base de datos local');
        setModalState('error');
      }
    },
    onError: (error: unknown) => {
      console.error("❌ Error en Login:", error);
      setErrorMessage(mensajeDeError(error, 'Credenciales incorrectas'));
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

  const abrirDesvincular = async () => {
    setUnenrollError('');
    // Conteos de datos que se perderían con el wipe (para advertir).
    const [multimedia, capturas] = await Promise.all([
      contarPendientesDeSubida().catch(() => 0),
      database.collections
        .get('local_captura')
        .query(Q.where('estado_sincro', Q.lte(0)))
        .fetchCount()
        .catch(() => 0),
    ]);
    setPendientesMultimedia(multimedia);
    setCapturasSinSubir(capturas);
    setIsUnenrollOpen(true);
  };

  const handleDesvincular = async () => {
    setUnenrollError('');
    setUnenrollLoading(true);
    try {
      // Autoritativo: solo tras el OK del backend se hace el wipe. Éxito → wipeData()
      // dispara el gate a Enrollment y esta pantalla se desmonta.
      await executeUnenroll();
    } catch (error) {
      setUnenrollError(mensajeDeError(error, 'No se pudo desvincular el dispositivo'));
      setUnenrollLoading(false);
    }
  };

  // --- ELIMINADA LA FUNCIÓN handleLogin DUPLICADA QUE CAUSABA ERROR ---

  return (
    <KeyboardAwareScrollView
      //behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-[#F3F4F6]"
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      bounces={false}
      enableOnAndroid={true} 
      extraScrollHeight={20}
    >
      {/* TouchableWithoutFeedback ahora ENVUELVE UN SOLO ELEMENTO (el ScrollView) */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        
          <View className="flex-1 items-center justify-center px-6 py-10">
            <View className="items-center mb-10">
              {/* Imagen del hombre (hombrefundea.jpeg) en un círculo */}
              <View className="w-24 h-24 rounded-full overflow-hidden mb-4 shadow-md border-2 border-[#1E3A8A]">
                <Image
                  source={require('../../../../assets/hombrefundea.jpeg')}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              </View>

              {/* Letras OneSite (letras_onesite.jpeg) */}
              <View className="h-10 w-40 mb-2">
                <Image
                  source={require('../../../../assets/letras onesite.jpeg')}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </View>
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
                <View className="flex-row items-center bg-[#F9FAFB] border border-gray-200 rounded-2xl pr-4">
                  <TextInput
                    className="flex-1 p-4 text-gray-800 text-base"
                    placeholder="Ingrese su contraseña"
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    secureTextEntry={!verPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setVerPassword((v) => !v)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Feather name={verPassword ? 'eye-off' : 'eye'} size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>
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

            {/* Desvinculación del equipo (p. ej. equipo mal enrolado). No requiere sesión. */}
            <TouchableOpacity
              className="mt-6 items-center active:opacity-70"
              onPress={abrirDesvincular}
            >
              <Text className="text-gray-400 text-xs">¿Equipo equivocado?</Text>
              <Text className="text-[#1E3A8A] text-sm font-semibold mt-0.5">Desvincular dispositivo</Text>
            </TouchableOpacity>
          </View>
      </TouchableWithoutFeedback>

      {/* El Modal Maestro queda AFUERA del TouchableWithoutFeedback, en el nivel del KeyboardAwareScrollView */}
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

      <DesvincularModal
        visible={isUnenrollOpen}
        error={unenrollError}
        loading={unenrollLoading}
        capturasSinSubir={capturasSinSubir}
        pendientesMultimedia={pendientesMultimedia}
        onConfirmar={handleDesvincular}
        onCancelar={() => setIsUnenrollOpen(false)}
      />

    </KeyboardAwareScrollView>
  );
};