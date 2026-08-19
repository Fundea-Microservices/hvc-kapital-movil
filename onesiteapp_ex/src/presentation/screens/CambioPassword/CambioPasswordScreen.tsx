import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

import { useAuthStore } from '../../store/useAuthStore';
import { useCambiarPasswordMutation } from '../../hooks/useCambiarPasswordMutation';
import { evaluarPolitica, type ResultadoPolitica } from '../../../domain/validacion/politicaPassword';
import { mensajeDeError } from '../../../data/remote/types/sync.types';

type ModalState = 'none' | 'syncing' | 'success' | 'error';

// Azul institucional: se usa tanto en el primario como en los indicadores cumplidos.
const AZUL = '#1E3A8A';

/** Una fila del checklist de reglas: ✓ azul si se cumple, ✗ gris si no. */
const ReglaItem = ({ cumple, texto }: { cumple: boolean; texto: string }) => (
  <View className="flex-row items-center mb-1.5">
    <Feather
      name={cumple ? 'check-circle' : 'circle'}
      size={16}
      color={cumple ? AZUL : '#9CA3AF'}
    />
    <Text className={`ml-2 text-sm ${cumple ? 'text-[#1E3A8A] font-semibold' : 'text-gray-400'}`}>
      {texto}
    </Text>
  </View>
);

/** Input de contraseña con botón de ojo para mostrar/ocultar. */
const CampoPassword = ({
  etiqueta,
  valor,
  onChangeText,
  visible,
  onToggle,
  placeholder,
}: {
  etiqueta: string;
  valor: string;
  onChangeText: (t: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder: string;
}) => (
  <View className="mb-5">
    <Text className="text-gray-600 mb-2 font-semibold ml-1">{etiqueta}</Text>
    <View className="flex-row items-center bg-[#F9FAFB] border border-gray-200 rounded-2xl pr-4">
      <TextInput
        className="flex-1 p-4 text-gray-800 text-base"
        placeholder={placeholder}
        value={valor}
        onChangeText={onChangeText}
        autoCapitalize="none"
        secureTextEntry={!visible}
      />
      <TouchableOpacity onPress={onToggle} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Feather name={visible ? 'eye-off' : 'eye'} size={20} color="#6B7280" />
      </TouchableOpacity>
    </View>
  </View>
);

export const CambioPasswordScreen = () => {
  const [passwordActual, setPasswordActual] = useState('');
  const [passwordNueva, setPasswordNueva] = useState('');
  const [confirmarPassword, setConfirmarPassword] = useState('');
  const [verActual, setVerActual] = useState(false);
  const [verNueva, setVerNueva] = useState(false);
  const [verConfirmar, setVerConfirmar] = useState(false);
  const [modalState, setModalState] = useState<ModalState>('none');
  const [errorMessage, setErrorMessage] = useState('No se pudo actualizar la contraseña');

  const token = useAuthStore((state) => state.token);
  const nombreCompleto = useAuthStore((state) => state.nombreCompleto);
  const limpiarCambioPassword = useAuthStore((state) => state.limpiarCambioPassword);

  const politica: ResultadoPolitica = evaluarPolitica(
    passwordActual,
    passwordNueva,
    confirmarPassword
  );

  const mutation = useCambiarPasswordMutation(token);

  const onPressGuardar = () => {
    if (!politica.esValida) return; // El botón ya está deshabilitado; guarda defensiva.
    Keyboard.dismiss();
    setModalState('syncing');
    mutation.mutate(
      { passwordActual, passwordNueva, confirmarPassword },
      {
        onSuccess: () => setModalState('success'),
        onError: (error) => {
          setErrorMessage(mensajeDeError(error, 'No se pudo actualizar la contraseña'));
          setModalState('error');
        },
      }
    );
  };

  // Éxito: se libera el gate borrando la bandera en SecureStore (fuente de verdad que
  // sobrevive reinicios) y en el store; App.tsx re-renderiza y cae al Dashboard.
  const onContinuar = async () => {
    await SecureStore.deleteItemAsync('requiere_cambio_password');
    setModalState('none');
    limpiarCambioPassword();
  };

  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-[#F3F4F6]"
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      bounces={false}
      enableOnAndroid={true}
      extraScrollHeight={20}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View className="flex-1 items-center justify-center px-6 py-10">
          <View className="items-center mb-8">
            <View className="w-20 h-20 rounded-full bg-[#1E3A8A] items-center justify-center mb-4 shadow-md">
              <Feather name="lock" size={36} color="white" />
            </View>
            <Text className="text-[#1E3A8A] text-2xl font-bold">Actualiza tu contraseña</Text>
            <Text className="text-gray-500 text-center mt-2 px-4">
              {nombreCompleto ? `Hola, ${nombreCompleto}. ` : ''}
              Por seguridad, define una nueva contraseña para tu primer ingreso.
            </Text>
          </View>

          <View className="bg-white w-full max-w-sm rounded-[32px] p-8 shadow-2xl elevation-5">
            <CampoPassword
              etiqueta="Contraseña actual (temporal)"
              valor={passwordActual}
              onChangeText={setPasswordActual}
              visible={verActual}
              onToggle={() => setVerActual((v) => !v)}
              placeholder="Ingrese su contraseña temporal"
            />
            <CampoPassword
              etiqueta="Nueva contraseña"
              valor={passwordNueva}
              onChangeText={setPasswordNueva}
              visible={verNueva}
              onToggle={() => setVerNueva((v) => !v)}
              placeholder="Ingrese su nueva contraseña"
            />
            <CampoPassword
              etiqueta="Confirmar nueva contraseña"
              valor={confirmarPassword}
              onChangeText={setConfirmarPassword}
              visible={verConfirmar}
              onToggle={() => setVerConfirmar((v) => !v)}
              placeholder="Repita su nueva contraseña"
            />

            <View className="mb-6 mt-1">
              <Text className="text-gray-500 mb-2 font-semibold ml-1">Tu contraseña debe cumplir:</Text>
              <ReglaItem cumple={politica.longitud} texto="Entre 8 y 20 caracteres" />
              <ReglaItem cumple={politica.mayuscula} texto="Una letra mayúscula" />
              <ReglaItem cumple={politica.minuscula} texto="Una letra minúscula" />
              <ReglaItem cumple={politica.numero} texto="Un número" />
              <ReglaItem cumple={politica.especial} texto="Un carácter especial (@#$%*!?&)" />
              <ReglaItem cumple={politica.coincideConfirmacion} texto="Coincide con la confirmación" />
              <ReglaItem cumple={politica.distintaDeActual} texto="Distinta a la actual" />
            </View>

            <TouchableOpacity
              className={`rounded-2xl py-4 items-center shadow-lg ${politica.esValida ? 'bg-[#1E3A8A]' : 'bg-gray-400'}`}
              onPress={onPressGuardar}
              disabled={!politica.esValida || mutation.isPending}
            >
              <Text className="text-white font-bold text-lg">
                {mutation.isPending ? 'Guardando...' : 'Guardar contraseña'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableWithoutFeedback>

      <Modal visible={modalState !== 'none'} transparent animationType="fade">
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          {modalState === 'syncing' ? (
            <View className="bg-white w-full max-w-[280px] rounded-[40px] p-10 items-center shadow-2xl">
              <ActivityIndicator size="large" color="#1E3A8A" />
              <Text className="text-gray-700 text-lg font-bold mt-6 text-center">Guardando contraseña...</Text>
            </View>
          ) : modalState === 'success' ? (
            <View className="bg-white w-full max-w-[320px] rounded-[40px] p-10 items-center shadow-2xl">
              <View className="bg-[#1E3A8A] w-20 h-20 rounded-full items-center justify-center mb-6">
                <Feather name="check" size={48} color="white" />
              </View>
              <Text className="text-xl font-bold text-gray-800 mb-2 text-center">¡Contraseña actualizada!</Text>
              <Text className="text-gray-500 text-center mb-8">
                Tu nueva contraseña quedó registrada. Ya puedes usar la aplicación.
              </Text>
              <TouchableOpacity
                className="bg-[#1E3A8A] w-full rounded-2xl py-4 items-center"
                onPress={onContinuar}
              >
                <Text className="text-white font-bold text-lg">Continuar</Text>
              </TouchableOpacity>
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
    </KeyboardAwareScrollView>
  );
};
