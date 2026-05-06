import React, { useState } from 'react';
import { 
  ScrollView, 
  KeyboardAvoidingView, 
  Platform, 
  SafeAreaView, 
  View, 
  Text, 
  TouchableOpacity, 
  Modal, 
  ActivityIndicator, 
  Alert 
} from 'react-native';
import { Feather } from '@expo/vector-icons';

// Componentes de UI creados en Sprints anteriores
import { SurveySection } from '../../components/Surveys/SurveySection';
import { SurveyField } from '../../components/Surveys/SurveyField';
import { SurveyMatrixCard } from '../../components/Surveys/SurveyMatrixCard';
import { SurveyMatrixSubform } from '../../components/Surveys/SurveyMatrixSubform';

// Servicios de Lógica y Persistencia
import { saveRespuestaOffline } from '../../../data/local/services/captura.service';
import { evaluarSintaxis, evaluarVisibilidad } from '../../../core/utils/rulesEngine';
import { buildAndSyncSurvey } from '../../../data/local/services/surveyBuilder.service';

// 1. SOLUCIÓN: Definimos la interfaz para recibir la función de navegación
interface SurveyFormScreenProps {
  onVolverInicio?: () => void;
}

/**
 * Pantalla Maestra del Formulario SGRAS (Orquestador de Sprints 5-9).
 * Gestiona la navegación por secciones, el motor de reglas offline y la sincronización final.
 */
export const SurveyFormScreen = ({ onVolverInicio }: SurveyFormScreenProps) => {
  // Estado para el manejo de secciones (Foco Único - Sprint 6)
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>('sec-1');
  
  // Estado de Sincronización (Sprint 9)
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Estado para el Modal de Matriz (Sprint 8)
  const [modalMatrizVisible, setModalMatrizVisible] = useState(false);
  const [cantidadLotes, setCantidadLotes] = useState(0);

  /** * Diccionario de respuestas en tiempo real para el motor de reglas.
   */
  const [respuestas, setRespuestas] = useState<Record<string, string>>({
    '101': '', // Área Maíz
    '102': '', // Área Frijol
    '103': '', // Área Total (Calculada)
  });

  const toggleSection = (sectionId: string) => {
    setExpandedSectionId(prev => prev === sectionId ? null : sectionId);
  };

  const handleBlur = async (idPregunta: string) => {
    const valor = respuestas[idPregunta];
    
    // 1. Persistencia inmediata en SQLite
    await saveRespuestaOffline(idPregunta, valor);

    // 2. Ejecución del Motor de Cálculos (S3.1)
    if (idPregunta === '101' || idPregunta === '102') {
      const resultado = evaluarSintaxis("[101] + [102]", respuestas);
      if (resultado !== null) {
        const valStr = resultado.toString();
        setRespuestas(prev => ({ ...prev, '103': valStr }));
        await saveRespuestaOffline('103', valStr);
      }
    }
  };

  const handleFinalizarSync = async () => {
    setIsSyncing(true);
    try {
      // Se asume ID '1' para la encuesta SGRAS Línea Base
      const resultado = await buildAndSyncSurvey('1');
      setIsSyncing(false);
      
      if (resultado.folio) {
        Alert.alert("Éxito", `Encuesta enviada exitosamente. Folio: #${resultado.folio}`, [
          { 
            text: "Aceptar", 
            onPress: () => {
              // LIMPIAR EL FORMULARIO
              setRespuestas({});
              setCantidadLotes(0); // Buena práctica: limpiar también el contador de la matriz
              
              // REGRESAR AL DASHBOARD
              if (onVolverInicio) onVolverInicio();
            } 
          }
        ]);
      }
    } catch (error) {
      setIsSyncing(false);
      
      // 2. SOLUCIÓN: Sintaxis correcta del arreglo de botones para el Alert
      Alert.alert(
        "Modo Offline", 
        "Los datos se guardaron localmente y se enviarán cuando detecte conexión.", 
        [
          { 
            text: "Entendido", 
            onPress: () => {
              setRespuestas({});
              setCantidadLotes(0);
              if (onVolverInicio) onVolverInicio();
            } 
          }
        ]
      );
    }
  };

  // Evaluación de visibilidad dinámica (S3.2)
  const esVisibleSeccionFrijol = evaluarVisibilidad("[101] > 0", respuestas);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      {/* Header de la Encuesta */}
      <View className="px-6 py-4 bg-white border-b border-gray-200 shadow-sm mt-8">
        <Text className="text-[#1E3A8A] font-bold text-2xl">SGRAS Línea Base</Text>
        <Text className="text-gray-500 text-xs font-semibold uppercase tracking-widest">
          Versión 2.2 • Formulario Dinámico
        </Text>
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        className="flex-1"
      >
        <ScrollView 
          className="flex-1 px-4 pt-4" 
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          
          <SurveySection 
            titulo="Áreas de Cultivo" 
            estado={respuestas['101'] ? 'completado' : 'vacio'} 
            isExpanded={expandedSectionId === 'sec-1'}
            onToggle={() => toggleSection('sec-1')}
          >
            <SurveyField 
              etiqueta="Área de Maíz (Ha)"
              esObligatorio={true}
              esEditable={true}
              valor={respuestas['101']}
              onChangeText={(txt) => setRespuestas({...respuestas, '101': txt})}
              onBlur={() => handleBlur('101')}
            />

            {esVisibleSeccionFrijol && (
              <SurveyField 
                etiqueta="Área de Frijol (Ha)"
                esObligatorio={false}
                esEditable={true}
                valor={respuestas['102']}
                onChangeText={(txt) => setRespuestas({...respuestas, '102': txt})}
                onBlur={() => handleBlur('102')}
              />
            )}

            <SurveyField 
              etiqueta="Área Total Calculada"
              esObligatorio={false}
              esEditable={false}
              valor={respuestas['103']}
              mensajeInfo="Valor calculado automáticamente"
              onChangeText={() => {}}
              onBlur={() => {}}
            />
          </SurveySection>

          <SurveySection 
            titulo="Detalle de Lotes" 
            estado={cantidadLotes > 0 ? 'completado' : 'vacio'} 
            isExpanded={expandedSectionId === 'sec-matriz'}
            onToggle={() => toggleSection('sec-matriz')}
          >
            <SurveyMatrixCard 
              titulo="Matriz de Parcelas"
              cantidadRegistros={cantidadLotes}
              onAbrirMatriz={() => setModalMatrizVisible(true)}
            />
          </SurveySection>

          <View className="h-20" />
        </ScrollView>

        <View className="p-6 bg-white border-t border-gray-100 shadow-2xl">
          <TouchableOpacity 
            className="bg-[#1E3A8A] rounded-2xl py-4 flex-row justify-center items-center shadow-lg"
            onPress={handleFinalizarSync}
          >
            {/* 3. SOLUCIÓN: Nombre de propiedad corregido */}
            <Feather name="upload-cloud" size={20} color="white" />
            <Text className="text-white font-bold ml-3 text-lg">Finalizar Encuesta</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <SurveyMatrixSubform 
        visible={modalMatrizVisible}
        tituloMatriz="Registro de Lotes"
        onClose={() => setModalMatrizVisible(false)}
        onFilaGuardada={() => setCantidadLotes(prev => prev + 1)}
      />

      <Modal visible={isSyncing} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-[300px] rounded-[40px] p-10 items-center">
            <ActivityIndicator size="large" color="#1E3A8A" />
            <Text className="text-xl font-bold text-gray-800 mt-6 text-center">
              Enviando datos...
            </Text>
            <Text className="text-gray-500 text-sm mt-2 text-center">
              El sistema está resguardando su información en el servidor central.
            </Text>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};