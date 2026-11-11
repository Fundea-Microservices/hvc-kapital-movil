import React from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';

/**
 * Modal de confirmación de desvinculación del dispositivo (acción destructiva).
 *
 * Es un componente PRESENTACIONAL puro: no conoce la red ni el store, solo recibe el
 * estado y emite callbacks. Así se prueba en aislamiento (sin renderizar el Dashboard
 * entero, que arrastra WatermelonDB y gráficos). La desvinculación NO pide contraseña;
 * el mensaje de error (de red/servidor) se verifica aquí y la lógica de wipe vive en
 * `useUnenroll`.
 */
export interface DesvincularModalProps {
  visible: boolean;
  error: string;
  loading: boolean;
  /** Capturas de encuesta sin subir (pendientes o pausadas) que se perderían. */
  capturasSinSubir: number;
  /** Archivos multimedia pendientes de subida que se perderían. */
  pendientesMultimedia: number;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export const DesvincularModal = ({
  visible,
  error,
  loading,
  capturasSinSubir,
  pendientesMultimedia,
  onConfirmar,
  onCancelar,
}: DesvincularModalProps) => {
  const hayPendientes = capturasSinSubir > 0 || pendientesMultimedia > 0;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-black/50 items-center justify-center px-6">
        <View className="bg-white w-full max-w-[340px] rounded-[32px] p-7 shadow-2xl">
          <View className="items-center mb-4">
            <View className="bg-[#EF4444] w-16 h-16 rounded-full items-center justify-center mb-4">
              <AlertTriangle size={30} color="white" />
            </View>
            <Text className="text-lg font-inter-semibold text-brand-blue text-center">Desvincular este dispositivo</Text>
          </View>

          <Text className="text-brand-steel text-sm text-center mb-3 font-sans">
            Se borrarán TODOS los datos en este equipo, para usar la aplicación deberá escribir el código de seguridad nuevamente.
          </Text>

          {hayPendientes && (
            <View className="bg-red-50 rounded-2xl p-3 mb-3">
              <Text className="text-red-600 text-xs font-inter-semibold text-center">
                ⚠ Tienes {capturasSinSubir} captura(s) y {pendientesMultimedia} archivo(s) sin subir. Se perderán.
              </Text>
            </View>
          )}

          {error !== '' && (
            <Text className="text-red-500 text-xs mb-2 text-center font-sans">{error}</Text>
          )}

          <View className="flex-row mt-2" style={{ gap: 12 }}>
            <TouchableOpacity
              className="flex-1 rounded-cta py-4 items-center bg-gray-100"
              onPress={onCancelar}
              disabled={loading}
            >
              <Text className="text-gray-700 font-inter-semibold">Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`flex-1 rounded-cta py-4 items-center ${loading ? 'bg-brand-gray' : 'bg-[#EF4444]'}`}
              onPress={onConfirmar}
              disabled={loading}
            >
              <Text className="text-white font-inter-semibold">{loading ? 'Desvinculando...' : 'Desvincular'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
