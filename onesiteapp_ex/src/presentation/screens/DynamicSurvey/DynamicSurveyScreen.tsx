import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../../data/local/database';
// @ts-ignore
import uuid from 'react-native-uuid';
import LocalEncuesta from '../../../data/local/models/LocalEncuesta';
import LocalEstructuraPregunta from '../../../data/local/models/LocalEstructuraPregunta';
import LocalSeccion from '../../../data/local/models/LocalSeccion';
import LocalCaptura from '../../../data/local/models/LocalCaptura';
import { SurveyField } from '../../components/Surveys/SurveyField';
import LocalCatalogo from '../../../data/local/models/LocalCatalogo'; // Agrega esta importación

interface Props {
  encuesta: LocalEncuesta;
  preguntas: LocalEstructuraPregunta[];
  secciones: LocalSeccion[];
  catalogos: LocalCatalogo[];
  onVolverInicio: () => void;
}

const DynamicSurvey = ({ encuesta, preguntas, secciones, catalogos, onVolverInicio }: Props) => {
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [instanciasMatriz, setInstanciasMatriz] = useState<Record<string, string[]>>({});

  // --- LOG DE DIAGNÓSTICO (Aparecerá en tu terminal de VS Code) ---
  useEffect(() => {
    console.log("=== 🔍 DIAGNÓSTICO DE LA ENCUESTA ===");
    console.log("Secciones cargadas:", secciones.map(s => s.nombre));
    console.log("Preguntas cargadas:", preguntas.map(p => ({
      etiqueta: p.etiqueta,
      tipo: p.tipo_dato,
      id_matriz_padre: p.id_matriz_padre
    })));
    console.log("======================================");
  }, [secciones, preguntas]);

  // --- MOTOR DE MATRICES ---
  const añadirFilaMatriz = (idPadre: string) => {
    const nuevoUuid = uuid.v4().toString();
    setInstanciasMatriz(prev => ({
      ...prev,
      [idPadre]: [...(prev[idPadre] || []), nuevoUuid]
    }));
  };

  const eliminarFilaMatriz = (idPadre: string, uuidEliminar: string) => {
    setInstanciasMatriz(prev => ({
      ...prev,
      [idPadre]: prev[idPadre].filter(id => id !== uuidEliminar)
    }));
  };

  // --- EVALUADOR DE VISIBILIDAD (Saltos Lógicos) ---
  const isQuestionVisible = (p: LocalEstructuraPregunta) => {
    if (!p.regla_visibilidad) return true;
    try {
      const regla = JSON.parse(p.regla_visibilidad);
      return respuestas[regla.dependeDe] === regla.valorEsperado;
    } catch (e) {
      return true;
    }
  };

  // --- EVALUADOR DE CÁLCULOS MATEMÁTICOS ---
  const getCalculatedValue = (p: LocalEstructuraPregunta) => {
    if (!p.sintaxis_calculo) return respuestas[p.id] || ''; 
    try {
      const regla = JSON.parse(p.sintaxis_calculo);
      const val1 = Number(respuestas[regla.variables[0]]) || 0;
      const val2 = Number(respuestas[regla.variables[1]]) || 0;
      
      let resultado = 0;
      if (regla.operacion === 'SUMA') resultado = val1 + val2;
      if (regla.operacion === 'RESTA') resultado = val1 - val2;
      if (regla.operacion === 'MULTIPLICACION') resultado = val1 * val2;

      const resultadoStr = resultado.toString();

      if (respuestas[p.id] !== resultadoStr) {
        setTimeout(() => setRespuestas(prev => ({ ...prev, [p.id]: resultadoStr })), 0);
      }
      return resultadoStr;
    } catch (e) {
      return '';
    }
  };

  // --- GUARDADO ---
  const handleFinalizarFormulario = async () => {
    setIsSaving(true);
    try {
      const instanciaEncuestaUuid = uuid.v4().toString();

      await database.write(async () => {
        const capturaCollection = database.collections.get<LocalCaptura>('local_captura');
        
        const batchCreate = Object.entries(respuestas).map(([key, valor]) => {
          const partes = key.split('_');
          const idPregunta = partes[0];
          const uuidFila = partes[1] || null;

          return capturaCollection.prepareCreate((record) => {
            record.id_encuesta = encuesta.id;
            record.id_pregunta = idPregunta;
            record.valor = valor;
            record.uuid_instancia = uuidFila ? `${instanciaEncuestaUuid}_${uuidFila}` : instanciaEncuestaUuid;
            record.estado_sincro = 0;
          });
        });

        await database.batch(...batchCreate);
      });

      Alert.alert("¡Éxito!", "Gestión guardada localmente y lista para enviar.", [{ text: "Finalizar", onPress: onVolverInicio }]);
    } catch (error) {
      console.error("Error al guardar:", error);
      Alert.alert("Error", "No se pudo guardar la captura.");
    } finally {
      setIsSaving(false);
    }
  };

  //  Función para interceptar catálogos
  const obtenerOpciones = (opcionesString: string | null) => {
    if (!opcionesString) return undefined;
    
    // Si la cadena empieza con 'CAT_', buscamos en WatermelonDB
    if (opcionesString.startsWith('CAT_')) {
      const items = catalogos
        .filter(c => c.nombre_catalogo === opcionesString)
        .map(c => c.valor_opcion);
      return items.length > 0 ? JSON.stringify(items) : undefined;
    }
    
    // Si no es un catálogo, asumimos que ya es un JSON quemado (Legacy)
    return opcionesString; 
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
        {secciones.map((seccion) => {
          const preguntasRaiz = preguntas.filter(p => 
            p.id_seccion === seccion.id && (!p.id_matriz_padre || p.id_matriz_padre === 'null')
          );

          if (preguntasRaiz.length === 0) return null;

          return (
            <View key={seccion.id} className="mb-8">
              <Text className="text-[#1E3A8A] font-bold text-xs uppercase mb-4 ml-2 tracking-widest">{seccion.nombre}</Text>

              {preguntasRaiz.map((p) => {
                if (!isQuestionVisible(p)) return null;

                if (p.tipo_dato?.toUpperCase() === 'MATRIZ') {
                  const preguntasHijas = preguntas.filter(hija => hija.id_matriz_padre === p.id);
                  const filas = instanciasMatriz[p.id] || [];

                  return (
                    <View key={p.id} className="mb-6 bg-blue-50/60 p-4 rounded-[32px] border border-blue-100">
                      <View className="flex-row justify-between items-center mb-4 px-2">
                        <Text className="font-bold text-[#1E3A8A] flex-1 mr-2">{p.etiqueta}</Text>
                        <TouchableOpacity 
                          onPress={() => añadirFilaMatriz(p.id)}
                          className="bg-[#1E3A8A] px-4 py-2 rounded-full flex-row items-center shadow-sm"
                        >
                          <Feather name="plus" size={16} color="white" />
                          <Text className="text-white font-bold ml-1 text-xs">Añadir Fila</Text>
                        </TouchableOpacity>
                      </View>

                      {filas.map((uuidFila, index) => (
                        <View key={uuidFila} className="bg-white p-5 rounded-[24px] mb-4 shadow-sm border border-gray-200">
                          <View className="flex-row justify-between items-center mb-4 border-b border-gray-100 pb-3">
                            <Text className="text-gray-400 font-black text-[10px] tracking-widest uppercase">
                              REFERENCIA #{index + 1}
                            </Text>
                            <TouchableOpacity onPress={() => eliminarFilaMatriz(p.id, uuidFila)} className="bg-red-50 p-2 rounded-full">
                              <Feather name="trash-2" size={16} color="#EF4444" />
                            </TouchableOpacity>
                          </View>

                          {preguntasHijas.map(hija => (
                            <View key={hija.id} className="mb-4">
                              <SurveyField
                                tipoDato={hija.tipo_dato}
                                etiqueta={hija.etiqueta}
                                esObligatorio={hija.es_obligatorio === 1}
                                esEditable={hija.es_editable === 1}
                                valor={respuestas[`${hija.id}_${uuidFila}`] || ''}
                                opciones={obtenerOpciones(hija.opciones)}
                                onChangeText={(txt) => setRespuestas(prev => ({ ...prev, [`${hija.id}_${uuidFila}`]: txt }))}
                                onBlur={() => {}}
                              />
                            </View>
                          ))}
                        </View>
                      ))}

                      {filas.length === 0 && (
                        <Text className="text-center text-blue-300 font-medium italic mt-2 mb-2">
                          No se han añadido referencias.
                        </Text>
                      )}
                    </View>
                  );
                }

                const valorActual = p.es_editable === 0 ? getCalculatedValue(p) : (respuestas[p.id] || '');

                return (
                  <View key={p.id} className="mb-4 bg-white p-5 rounded-[24px] shadow-sm border border-gray-100">
                    <SurveyField
                      tipoDato={p.tipo_dato}
                      etiqueta={p.etiqueta}
                      esObligatorio={p.es_obligatorio === 1}
                      esEditable={p.es_editable === 1}
                      valor={valorActual}
                      opciones={obtenerOpciones(p.opciones)}
                      onChangeText={(txt) => setRespuestas(prev => ({ ...prev, [p.id]: txt }))}
                      onBlur={() => {}}
                      mensajeInfo={p.es_editable === 0 ? "Calculado automáticamente" : undefined} 
                    />
                  </View>
                );
              })}
            </View>
          );
        })}

        <TouchableOpacity
          className={`p-5 rounded-[22px] flex-row justify-center items-center mb-16 shadow-lg ${isSaving ? 'bg-gray-400' : 'bg-[#059669]'}`}
          onPress={handleFinalizarFormulario}
          disabled={isSaving}
        >
          {isSaving ? <ActivityIndicator color="white" /> : (
            <><Feather name="check-circle" size={24} color="white" /><Text className="text-white font-bold text-lg ml-3">Finalizar Gestión</Text></>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* --- EL MODAL DE PAUSA RESTAURADO --- */}
      <Modal visible={showPauseModal} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-[320px] rounded-[40px] p-10 items-center shadow-2xl">
            <View className="bg-amber-100 p-4 rounded-full mb-4">
              <Feather name="pause-circle" size={48} color="#F59E0B" />
            </View>
            <Text className="text-xl font-bold text-gray-800 text-center">¿Pausar encuesta?</Text>
            <Text className="text-gray-500 text-center mt-3 leading-5">
              Los datos ingresados no se perderán. Podrás continuar después.
            </Text>

            <View className="flex-row mt-10 gap-3">
              <TouchableOpacity className="flex-1 py-4 bg-gray-50 rounded-2xl border border-gray-200" onPress={() => setShowPauseModal(false)}>
                <Text className="text-center text-gray-600 font-bold">Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-[#1E3A8A] py-4 rounded-2xl shadow-md"
                onPress={() => { setShowPauseModal(false); onVolverInicio(); }}
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

const enhance = withObservables(['idEncuesta'], ({ idEncuesta }: { idEncuesta: string }) => ({
  encuesta: database.collections.get<LocalEncuesta>('local_encuesta').findAndObserve(idEncuesta),
  secciones: database.collections.get<LocalSeccion>('local_seccion').query(Q.where('id_encuesta', idEncuesta), Q.sortBy('orden', Q.asc)),
  preguntas: database.collections.get<LocalEstructuraPregunta>('local_estructura_pregunta').query(Q.where('id_encuesta', idEncuesta), Q.sortBy('orden', Q.asc)),
  catalogos: database.collections.get<LocalCatalogo>('local_catalogos').query(),
}));

export const DynamicSurveyScreen = enhance(DynamicSurvey);