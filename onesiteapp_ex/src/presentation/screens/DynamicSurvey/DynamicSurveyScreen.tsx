import React, { useState } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../../data/local/database';
//import LocalEncuesta from '../../../data/local/models/LocalEncuesta';
import LocalEncuesta from '../../../data/local/models/LocalEncuesta'; // USAR EL UNIFICADO
import LocalEstructuraPregunta from '../../../data/local/models/LocalEstructuraPregunta';
import { SurveyField } from '../../components/Surveys/SurveyField';

interface Props {
  encuesta: LocalEncuesta;
  preguntas: LocalEstructuraPregunta[];
  onVolverInicio: () => void; // Unificamos el nombre aquí
}

const DynamicSurvey = ({ encuesta, preguntas, onVolverInicio }: Props) => {
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-row items-center justify-between px-4 py-4 bg-white border-b border-gray-200 mt-8">
        <TouchableOpacity onPress={() => setShowPauseModal(true)}>
          <Feather name="arrow-left" size={24} color="#374151" />
        </TouchableOpacity>
        <View className="flex-1 ml-3">
          <Text className="text-[#1E3A8A] font-bold text-lg">{encuesta.nombre}</Text>
          <Text className="text-gray-500 text-xs">Formulario Dinámico</Text>
        </View>
      </View>

      <ScrollView className="flex-1 p-4">
        {preguntas.map((p) => (
          <View key={p.id} className="mb-2">
            {/* Corregimos el error de Text: todo string DEBE estar en <Text> */}
            <Text className="text-gray-700 font-bold mb-2">
              {p.etiqueta} {p.es_editable === 1 && <Text className="text-red-500">*</Text>}
            </Text>
            <SurveyField 
              etiqueta=""
              esObligatorio={p.es_editable === 1}
              esEditable={p.es_editable === 1}
              valor={respuestas[p.id] || ''}
              onChangeText={(txt) => setRespuestas({...respuestas, [p.id]: txt})}
              onBlur={() => {}}
            />
          </View>
        ))}
      </ScrollView>

      {/* Modal de Pausa */}
      <Modal visible={showPauseModal} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-[300px] rounded-[32px] p-8 items-center">
            <Feather name="pause-circle" size={48} color="#F59E0B" />
            <Text className="text-xl font-bold mt-4">¿Pausar encuesta?</Text>
            <View className="flex-row mt-8">
              <TouchableOpacity className="flex-1 py-3" onPress={() => setShowPauseModal(false)}>
                <Text className="text-center text-gray-600 font-bold">Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                className="flex-1 bg-[#1E3A8A] py-3 rounded-xl" 
                onPress={() => { 
                  setShowPauseModal(false); 
                  onVolverInicio(); // Ahora el nombre coincide con la prop
                }}
              >
                <Text className="text-center text-white font-bold">Sí, pausar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// HOC para inyectar datos reactivos
const enhance = withObservables(['idEncuesta'], ({ idEncuesta }: { idEncuesta: string }) => ({
  encuesta: database.collections.get<LocalEncuesta>('local_encuesta').findAndObserve(idEncuesta),
  preguntas: database.collections.get<LocalEstructuraPregunta>('local_estructura_pregunta')
    .query(
      Q.where('id_encuesta', idEncuesta), // Asegúrate que en schema.ts sea 'id_encuesta'
      Q.sortBy('orden', Q.asc)
    ),
}));

export const DynamicSurveyScreen = enhance(DynamicSurvey);