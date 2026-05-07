import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../../data/local/database';
// @ts-ignore
import uuid from 'react-native-uuid'; // Necesitarás: npm install react-native-uuid

import LocalEncuesta from '../../../data/local/models/LocalEncuesta';
import LocalEstructuraPregunta from '../../../data/local/models/LocalEstructuraPregunta';
import LocalSeccion from '../../../data/local/models/LocalSeccion';
import LocalCaptura from '../../../data/local/models/LocalCaptura';
import { SurveyField } from '../../components/Surveys/SurveyField';

interface Props {
  encuesta: LocalEncuesta;
  preguntas: LocalEstructuraPregunta[];
  secciones: LocalSeccion[];
  onVolverInicio: () => void;
}

const DynamicSurvey = ({ encuesta, preguntas, secciones, onVolverInicio }: Props) => {
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});

  const handleFinalizarFormulario = async () => {
    // 1. Validación de obligatorios
    const obligatoriasFaltantes = preguntas
      .filter(p => p.es_obligatorio === 1 && (!respuestas[p.id] || respuestas[p.id].trim() === ''))
      .map(p => p.etiqueta);

    if (obligatoriasFaltantes.length > 0) {
      Alert.alert("Campos Obligatorios", `Faltan:\n• ${obligatoriasFaltantes.join('\n• ')}`);
      return;
    }

    setIsSaving(true);
    try {
      // Generamos un ID único para esta "sesión" de encuesta
      const instanciaId = uuid.v4().toString();

      await database.write(async () => {
        const capturaCollection = database.collections.get<LocalCaptura>('local_captura');
        
        // Creamos un registro por cada respuesta (Mapeo relacional)
        const batchCreate = Object.entries(respuestas).map(([preguntaId, valor]) => 
          capturaCollection.prepareCreate((record) => {
            record.id_encuesta = encuesta.id;
            record.id_pregunta = preguntaId;
            record.valor = valor;
            record.uuid_instancia = instanciaId;
            record.estado_sincro = 0; // 0 = Pendiente
          })
        );

        await database.batch(...batchCreate);
      });

      Alert.alert("¡Éxito!", "Captura guardada localmente.", [{ text: "Finalizar", onPress: onVolverInicio }]);
    } catch (error) {
      console.error("Error al guardar:", error);
      Alert.alert("Error", "No se pudo guardar la captura.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      {/* HEADER */}
      <View className="flex-row items-center justify-between px-4 py-4 bg-white border-b border-gray-200">
        <TouchableOpacity onPress={() => setShowPauseModal(true)}>
          <Feather name="arrow-left" size={24} color="#374151" />
        </TouchableOpacity>
        <View className="flex-1 ml-3">
          <Text className="text-[#1E3A8A] font-bold text-lg">{encuesta.nombre.toUpperCase()}</Text>
          <Text className="text-gray-500 text-xs">Modo Offline Activo</Text>
        </View>
      </View>

      <ScrollView className="flex-1 p-4" keyboardShouldPersistTaps="handled">
        {/* RED DE SEGURIDAD: Si no hay secciones, pero sí hay preguntas */}
        {secciones.length === 0 && preguntas.length > 0 && (
           <View className="mb-6">
             <Text className="text-red-500 font-bold mb-4 ml-2">Preguntas sin sección asignada:</Text>
             {preguntas.map((p) => (
                <View key={p.id} className="mb-4 bg-white p-5 rounded-[24px] shadow-sm border border-gray-100">
                  <SurveyField
                    tipoDato={p.tipo_dato}
                    etiqueta={p.etiqueta}
                    esObligatorio={p.es_obligatorio === 1}
                    esEditable={p.es_editable === 1}
                    valor={respuestas[p.id] || ''}
                    opciones={p.opciones || undefined}
                    onChangeText={(txt) => setRespuestas(prev => ({ ...prev, [p.id]: txt }))}
                    onBlur={() => {}} 
                  />
                </View>
             ))}
           </View>
        )}
        {/* RENDERIZADO NORMAL POR SECCIONES */}
        {secciones.map((seccion) => {
          const preguntasSeccion = preguntas.filter(p => p.id_seccion === seccion.id);
          if (preguntasSeccion.length === 0) return null;

          return (
            <View key={seccion.id} className="mb-6">
              <Text className="text-[#1E3A8A] font-bold text-xs uppercase mb-3 ml-2 tracking-widest">
                {seccion.nombre}
              </Text>
              {preguntasSeccion.map((p) => (
                <View key={p.id} className="mb-4 bg-white p-5 rounded-[24px] shadow-sm border border-gray-100">
                  <SurveyField
                    tipoDato={p.tipo_dato}
                    etiqueta={p.etiqueta}
                    esObligatorio={p.es_obligatorio === 1}
                    esEditable={p.es_editable === 1}
                    valor={respuestas[p.id] || ''}
                    opciones={p.opciones || undefined}
                    onChangeText={(txt) => setRespuestas(prev => ({ ...prev, [p.id]: txt }))}
                    onBlur={() => {}} 
                  />
                </View>
              ))}
            </View>
          );
        })}

        <TouchableOpacity
          className={`p-5 rounded-[22px] flex-row justify-center items-center mb-16 shadow-lg ${isSaving ? 'bg-gray-400' : 'bg-green-600'}`}
          onPress={handleFinalizarFormulario}
          disabled={isSaving}
        >
          {isSaving ? <ActivityIndicator color="white" /> : (
            <><Feather name="check-circle" size={24} color="white" /><Text className="text-white font-bold text-lg ml-3">Finalizar Gestión</Text></>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Modal de Pausa */}
      <Modal visible={showPauseModal} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-[320px] rounded-[40px] p-10 items-center">
            <Feather name="pause-circle" size={48} color="#F59E0B" />
            <Text className="text-xl font-bold mt-4">¿Pausar encuesta?</Text>
            <View className="flex-row mt-10 gap-3">
              <TouchableOpacity className="flex-1 py-4" onPress={() => setShowPauseModal(false)}>
                <Text className="text-center text-gray-500 font-bold">Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 bg-[#1E3A8A] py-4 rounded-2xl" onPress={() => { setShowPauseModal(false); onVolverInicio(); }}>
                <Text className="text-center text-white font-bold">Sí, pausar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const enhance = withObservables(['idEncuesta'], ({ idEncuesta }: { idEncuesta: string }) => ({
  encuesta: database.collections.get<LocalEncuesta>('local_encuesta').findAndObserve(idEncuesta),
  secciones: database.collections.get<LocalSeccion>('local_seccion').query(Q.where('id_encuesta', idEncuesta), Q.sortBy('orden', Q.asc)),
  preguntas: database.collections.get<LocalEstructuraPregunta>('local_estructura_pregunta').query(Q.where('id_encuesta', idEncuesta), Q.sortBy('orden', Q.asc)),
}));

export const DynamicSurveyScreen = enhance(DynamicSurvey);