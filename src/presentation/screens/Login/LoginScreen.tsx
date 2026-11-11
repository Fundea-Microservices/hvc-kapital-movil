import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator, Platform, ScrollView, Keyboard, Alert, Image, TouchableWithoutFeedback } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, LockKeyhole, User, X } from 'lucide-react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Q } from '@nozbe/watermelondb';

import { loginApi, registrarSesionApi } from '../../../data/remote/auth.api';
import { useAuthStore } from '../../store/useAuthStore';
import { authLocalService } from '../../../data/local/services/authLocalService';
import { runFullSync } from '../../../data/local/services/syncManager';
import { mensajeDeError } from '../../../data/remote/types/sync.types';
import { useUnenroll } from '../../hooks/useUnenroll';
import { DesvincularModal } from '../../components/DesvincularModal';
import { contarPendientesDeSubida } from '../../../data/local/services/multimedia.service';
import { database } from '../../../data/local/database';
import { COLORES } from '../../theme/colores';

type LoginModalState = 'none' | 'syncing' | 'error';

export const LoginScreen = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  // Borde naranja solo en el campo con foco (guía de componentes).
  const [campoEnfocado, setCampoEnfocado] = useState<'usuario' | 'password' | null>(null);
  const insets = useSafeAreaInsets();
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
        // El API de auth aún no emite refresh token: se borra el viejo para que el
        // interceptor no intente refrescar con una credencial de otro servidor.
        if (data.refreshToken) {
          await SecureStore.setItemAsync('refresh_token', data.refreshToken);
        } else {
          await SecureStore.deleteItemAsync('refresh_token');
        }
        await SecureStore.setItemAsync('user_id', data.user_id); // GUID de auth.Usuario
        await SecureStore.setItemAsync('user_name', data.usuario || username.trim());

        // 1b. Registrar la sesión en nuestro backend: el login ocurrió fuera, así que
        // `app.Sesiones` solo se llena aquí. De paso trae las banderas propias de la
        // app. Best-effort: si el backend no responde, el login NO se cae.
        let debeCambiarPassword = !!data.requiereCambioPassword;
        console.log('[SESION] Registrando sesión en el backend…');
        try {
          const sesion = await registrarSesionApi(data.token_sesion);
          debeCambiarPassword = sesion.requiereCambioPassword;
          console.log(
            `[SESION] OK requiereCambioPassword=${sesion.requiereCambioPassword} tipo=${sesion.tipoUsuario}`
          );
          if (sesion.tipoUsuario) {
            await SecureStore.setItemAsync('tipo_usuario', sesion.tipoUsuario);
          }
        } catch (e) {
          // Visible a propósito: el fallo es silencioso para el usuario (el login sigue),
          // pero deja la bandera de cambio de contraseña en falso.
          console.error('[SESION] FALLÓ el registro de sesión:', mensajeDeError(e, 'sin detalle'));
        }

        await SecureStore.setItemAsync('requiere_cambio_password', String(debeCambiarPassword));

        // 2. Identidad: toda viene en el login; el API de auth no tiene /permisos.
        const nombreParaMostrar = data.nombrecompleto || username.trim();
        await SecureStore.setItemAsync('nombre_completo', nombreParaMostrar);

        // 3. GUARDADO OFFLINE
        // Permisos vacíos: sin endpoint de permisos granulares el menú se muestra completo.
        await authLocalService.savePerfilOffline({
          UsuarioGuid: data.user_id,
          NombreCompleto: nombreParaMostrar || username,
          Usuario: data.usuario,
          FotoUrl: data.fotoUrl,
          RolNombre: data.rol || 'Usuario',
          Permisos: '{}',
        });

        setModalState('none');
        setLoggedIn(data.token_sesion, data.user_id, nombreParaMostrar, debeCambiarPassword);

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
      className="flex-1 bg-brand-light"
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      bounces={false}
      enableOnAndroid={true} 
      extraScrollHeight={20}
    >
      {/* TouchableWithoutFeedback ahora ENVUELVE UN SOLO ELEMENTO (el ScrollView) */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        
          <View className="flex-1">
            {/* Cabecera de marca: logo sobre blanco, separado por una línea sutil. */}
            <View className="bg-white pb-5 items-center border-b border-gray-100" style={{ paddingTop: insets.top + 16 }}>
              <Image
                source={require('../../../../assets/logo-hvc.png')}
                style={{ width: 230, height: 90 }}
                resizeMode="stretch"
              />
            </View>

            <View className="px-7 pt-8">
              <Text className="text-brand-blue text-2xl font-inter-bold text-center mb-7">
                Iniciar Sesión
              </Text>

              <Text className="text-brand-blue mb-1.5 font-inter-medium">Usuario</Text>
              <View
                className="flex-row items-center border rounded-input px-4 bg-white mb-4"
                style={{ borderColor: campoEnfocado === 'usuario' ? COLORES.orange : COLORES.gray }}
              >
                <User size={20} color={campoEnfocado === 'usuario' ? COLORES.orange : COLORES.gray} />
                <TextInput
                  className="flex-1 py-3.5 px-3 text-brand-navy text-base font-sans"
                  placeholder="Ingrese su usuario"
                  placeholderTextColor={COLORES.mist}
                  value={username}
                  onChangeText={setUsername}
                  onFocus={() => setCampoEnfocado('usuario')}
                  onBlur={() => setCampoEnfocado(null)}
                  autoCapitalize="none"
                />
              </View>

              <Text className="text-brand-blue mb-1.5 font-inter-medium">Contraseña</Text>
              <View
                className="flex-row items-center border rounded-input px-4 bg-white mb-7"
                style={{ borderColor: campoEnfocado === 'password' ? COLORES.orange : COLORES.gray }}
              >
                <LockKeyhole size={20} color={campoEnfocado === 'password' ? COLORES.orange : COLORES.gray} />
                <TextInput
                  className="flex-1 py-3.5 px-3 text-brand-navy text-base font-sans"
                  placeholder="Ingrese su contraseña"
                  placeholderTextColor={COLORES.mist}
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setCampoEnfocado('password')}
                  onBlur={() => setCampoEnfocado(null)}
                  autoCapitalize="none"
                  secureTextEntry={!verPassword}
                />
                <TouchableOpacity
                  onPress={() => setVerPassword((v) => !v)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  {verPassword
                    ? <EyeOff size={20} color={COLORES.steel} />
                    : <Eye size={20} color={COLORES.steel} />}
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                className={`rounded-cta py-4 items-center shadow-md ${username && password ? 'bg-brand-navy' : 'bg-brand-gray'}`}
                onPress={onPressLogin}
                disabled={!username || !password || loginMutation.isPending}
              >
                <Text className="text-white font-inter-semibold text-lg">
                  {loginMutation.isPending ? 'Validando...' : 'Ingresar'}
                </Text>
              </TouchableOpacity>

              {/* Desvinculación del equipo (p. ej. equipo mal enrolado). No requiere sesión. */}
              <TouchableOpacity
                className="mt-8 items-center active:opacity-70"
                onPress={abrirDesvincular}
              >
                <Text className="text-brand-mist text-xs font-sans">¿Quieres eliminar tu registro en este dispositivo?</Text>
                <Text className="text-brand-blue text-sm font-inter-semibold mt-0.5">Eliminar registro</Text>
              </TouchableOpacity>
            </View>
          </View>
      </TouchableWithoutFeedback>

      {/* El Modal Maestro queda AFUERA del TouchableWithoutFeedback, en el nivel del KeyboardAwareScrollView */}
      <Modal visible={modalState !== 'none'} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          {modalState === 'syncing' ? (
            <View className="bg-white w-full max-w-[280px] rounded-[40px] p-10 items-center shadow-2xl">
              <ActivityIndicator size="large" color={COLORES.navy} />
              <Text className="text-brand-blue text-lg font-inter-semibold mt-6 text-center">Iniciando sesión...</Text>
            </View>
          ) : (
            <View className="bg-white w-full max-w-[320px] rounded-[40px] p-10 items-center shadow-2xl">
              <View className="bg-[#EF4444] w-20 h-20 rounded-full items-center justify-center mb-6">
                <X size={44} color="white" />
              </View>
              <Text className="text-xl font-inter-bold text-brand-blue mb-10 text-center">{errorMessage}</Text>
              <TouchableOpacity
                className="bg-brand-navy w-full rounded-cta py-4 items-center"
                onPress={() => setModalState('none')}
              >
                <Text className="text-white font-inter-semibold text-lg">Aceptar</Text>
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