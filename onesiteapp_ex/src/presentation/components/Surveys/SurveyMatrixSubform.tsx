import React, { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, SafeAreaView, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SurveyField } from './SurveyField';
import { generateUUID } from '../../../core/utils/uuid';
import { saveRespuestaOffline } from '../../../data/local/services/captura.service';

interface SurveyMatrixSubformProps {
  visible: boolean;
  tituloMatriz: string;
  onClose: () => void;
  onFilaGuardada: () => void; // Callback para actualizar el contador en la pantalla principal
}

/**
 * El componente gestiona el ciclo de vida de una fila de matriz (S4.1 y S4.4).
 * Genera un UUID por sesión y valida los campos obligatorios antes de guardar.
 */
export const SurveyMatrixSubform = ({ visible, tituloMatriz, onClose, onFilaGuardada }: SurveyMatrixSubformProps) => {
  const [uuidInstancia, setUuidInstancia] = useState<string>('');
  
  // Estado local para los campos del subformulario
  const [filaData, setFilaData] = useState({
    nombreLote: '',
    tamanoLote: '',
  });

  // El sistema genera un nuevo UUID cada vez que se abre el modal para un nuevo registro
  useEffect(() => {
    if (visible) {
      setUuidInstancia(generateUUID());
      setFilaData({ nombreLote: '', tamanoLote: '' }); // Limpia el formulario
    }
  }, [visible]);

  /**
   * La función valida la integridad de la fila y guarda en la base de datos local.
   */
  const handleGuardarFila = async () => {
    // 1. Validación de Integridad (S4.4)
    if (!filaData.nombreLote.trim() || !filaData.tamanoLote.trim()) {
      Alert.alert("Campos incompletos", "Por favor, llene todos los campos obligatorios marcados en rojo.");
      return;
    }

    // 2. Guardado Batch (Auto-Save asociado al UUID de la instancia)
    // Se asume que '201' y '202' son los IDs de las preguntas hijas de la matriz
    await saveRespuestaOffline('201', filaData.nombreLote, uuidInstancia);
    await saveRespuestaOffline('202', filaData.tamanoLote, uuidInstancia);

    // 3. Cierre exitoso
    onFilaGuardada();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView className="flex-1 bg-gray-50">
        
        {/* Cabecera del Modal */}
        <View className="flex-row items-center justify-between px-4 py-4 bg-white border-b border-gray-200 shadow-sm">
          <Text className="text-[#1E3A8A] font-bold text-lg flex-1">Nuevo: {tituloMatriz}</Text>
          <TouchableOpacity onPress={onClose} className="p-2 bg-gray-100 rounded-full">
            <Feather name="x" size={24} color="#EF4444" />
          </TouchableOpacity>
        </View>

        {/* Cuerpo del Subformulario (Hereda la Identidad Visual S2.3) */}
        <ScrollView className="flex-1 p-6" showsVerticalScrollIndicator={false}>
          <Text className="text-gray-500 mb-6 text-sm">
            UUID Asignado: {uuidInstancia.split('-')[0]}...
          </Text>

          <SurveyField 
            etiqueta="Nombre del Lote / Parcela"
            esObligatorio={true}
            esEditable={true}
            valor={filaData.nombreLote}
            onChangeText={(txt) => setFilaData({ ...filaData, nombreLote: txt })}
            onBlur={() => {}} // El Auto-Save se delega al botón final en las matrices
          />

          <SurveyField 
            etiqueta="Tamaño del Lote (Ha)"
            esObligatorio={true}
            esEditable={true}
            valor={filaData.tamanoLote}
            onChangeText={(txt) => setFilaData({ ...filaData, tamanoLote: txt })}
            onBlur={() => {}}
          />
        </ScrollView>

        {/* Pie del Modal: Acciones */}
        <View className="p-6 bg-white border-t border-gray-100">
          <TouchableOpacity 
            className="bg-[#10B981] rounded-2xl py-4 items-center shadow-lg active:bg-[#059669]"
            onPress={handleGuardarFila}
          >
            <Text className="text-white font-bold text-lg">Guardar Fila</Text>
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </Modal>
  );
};