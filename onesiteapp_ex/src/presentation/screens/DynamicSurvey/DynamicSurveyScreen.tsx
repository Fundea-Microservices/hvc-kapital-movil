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
import { CatalogoOpcion } from '../../../data/local/models/CatalogoOpcion';
import { SurveyField } from '../../components/Surveys/SurveyField';
import { evaluate } from 'mathjs';
import { useNavigation } from '@react-navigation/native';

interface Props {
  route: any; // ⚡ INYECTADO: Para leer los parámetros de navegación de forma directa y segura
  encuesta: LocalEncuesta | null;
  preguntas: LocalEstructuraPregunta[];
  secciones: LocalSeccion[];
  catalogos: CatalogoOpcion[];
  capturasExistentes: LocalCaptura[]; 
}

const DynamicSurvey = ({ route, encuesta, preguntas, secciones, catalogos, capturasExistentes }: Props) => {
  const navigation = useNavigation<any>();
  const [showPauseModal, setShowPauseModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [respuestas, setRespuestas] = useState<Record<string, string>>({});
  const [instanciasMatriz, setInstanciasMatriz] = useState<Record<string, string[]>>({});

  // ⚡ ID SEGURO: Extraído del router para evitar colapsos si el modelo 'encuesta' está en la fase de carga
  const idEncuestaSeguro = route?.params?.idEncuesta || '';

  // --- MOTOR DE RESTAURACIÓN DE BORRADORES ---
  useEffect(() => {
    if (capturasExistentes && capturasExistentes.length > 0) {
      console.log(`📦 [BORRADOR]: Restaurando ${capturasExistentes.length} respuestas previas...`);
      const mapaRespuestas: Record<string, string> = {};
      const mapaMatrices: Record<string, string[]> = {};

      capturasExistentes.forEach((cap: any) => {
        const raw = cap._raw;
        const idPregunta = raw.id_pregunta;
        const uuidInstancia = raw.uuid_instancia || '';
        
        const partesUuid = uuidInstancia.split('_');
        const uuidFila = partesUuid[1] || null;

        const llaveEstado = uuidFila ? `${idPregunta}_${uuidFila}` : idPregunta;
        mapaRespuestas[llaveEstado] = raw.valor || '';

        if (uuidFila) {
          const preguntaObj = preguntas.find(p => p.id === idPregunta);
          const idMatrizPadre = preguntaObj?.id_matriz_padre;
          if (idMatrizPadre && idMatrizPadre !== 'null') {
            if (!mapaMatrices[idMatrizPadre]) mapaMatrices[idMatrizPadre] = [];
            if (!mapaMatrices[idMatrizPadre].includes(uuidFila)) {
              mapaMatrices[idMatrizPadre].push(uuidFila);
            }
          }
        }
      });

      setRespuestas(mapaRespuestas);
      setInstanciasMatriz(mapaMatrices);
    }
  }, [capturasExistentes]);

  // --- DIAGNÓSTICO PROFUNDO EN CONSOLA ---
  useEffect(() => {
   console.log("=== 🔍 RASTREO DE PREGUNTAS TIPO SELECT/RADIO ===");
    
    // Filtramos solo las preguntas que necesitan catálogos
    const preguntasCombo = preguntas.filter(p => 
      p.tipo_dato?.toUpperCase() === 'SELECT' || 
      p.tipo_dato?.toUpperCase() === 'RADIO'
    );

    if (preguntasCombo.length > 0) {
      preguntasCombo.forEach((p, index) => {
        console.log(`[Combo #${index + 1}] Etiqueta: "${p.etiqueta}"`);
        console.log(`-> opciones (columna):`, (p._raw as any).opciones);
        console.log(`-> origen_datos_cmd (columna):`, (p._raw as any).origen_datos_cmd);
        console.log("-----------------------------------------");
      });
    } else {
      console.log("⚠️ Alerta: No se encontraron preguntas de tipo SELECT o RADIO en esta encuesta.");
    }
    console.log("=================================================");
  }, [preguntas]);;

  // --- MOTOR DE MATRICES ---
  const añadirFilaMatriz = (idPadre: string) => {
    const nuevoUuid = uuid.v4().toString();
    setInstanciasMatriz(prev => ({ ...prev, [idPadre]: [...(prev[idPadre] || []), nuevoUuid] }));
  };

  const eliminarFilaMatriz = (idPadre: string, uuidEliminar: string) => {
    setInstanciasMatriz(prev => ({ ...prev, [idPadre]: prev[idPadre].filter(id => id !== uuidEliminar) }));
  };

  // --- EVALUADOR DE VISIBILIDAD ---
  const isQuestionVisible = (p: LocalEstructuraPregunta) => {
    if (!p.regla_visibilidad) return true;
    try {
      const regla = JSON.parse(p.regla_visibilidad);
      return respuestas[regla.dependeDe] === regla.valorEsperado;
    } catch (e) {
      return true;
    }
  };

  const handleRespuestaChange = (idPregunta: string, valor: string) => {
    const nuevasRespuestas = { ...respuestas, [idPregunta]: valor };
    let huboCambios = true;
    let iteraciones = 0;

    while (huboCambios && iteraciones < 5) {
      huboCambios = false;
      iteraciones++;

      preguntas
        .filter(p => p.tipo_dato === 'CALCULO' && p.sintaxis_calculo)
        .forEach(p => {
          try {
            const reglas = JSON.parse(p.sintaxis_calculo ?? '{}');
            const scope: Record<string, number> = {};
            let puedeCalcular = true;

            for (const [nombreVariable, idRef] of Object.entries(reglas.variables)) {
              const val = nuevasRespuestas[idRef as string];
              const num = parseFloat(nuevasRespuestas[idRef as string]);
              if (!val || isNaN(num)) {
                puedeCalcular = false;
                break;
              }
              scope[nombreVariable] = num;
            }

            if (puedeCalcular) {
              const resultado = evaluate(reglas.formula, scope);
              const resultadoStr = parseFloat(resultado.toFixed(2)).toString();
              if (nuevasRespuestas[p.id] !== resultadoStr) {
                nuevasRespuestas[p.id] = resultadoStr;
                huboCambios = true;
              }
            } else {
              nuevasRespuestas[p.id] = '';
            }
          } catch (error) {
            console.error(`Error en cálculo:`, error);
          }
        });
    }
    setRespuestas(nuevasRespuestas);
  };

  // ==========================================================================
  // FIX CRÍTICO ACCIÓN: GUARDAR ACCIÓN DE PAUSA SIN ERRORES EN LA OPERACIÓN
  // ==========================================================================
  const handlePausarFormulario = async () => {
    setIsSaving(true);
    try {
      // ⚡ SOLUCIÓN ANTI-CRASH: Inicializamos con un nuevo UUID por defecto
      let instanciaEncuestaUuid = uuid.v4().toString();

      // Validamos de forma estricta y segura si existe un borrador previo en el arreglo
      if (capturasExistentes && capturasExistentes.length > 0) {
        const primerBorrador = capturasExistentes[0];
        if (primerBorrador && primerBorrador._raw) {
          const datosCrudos = primerBorrador._raw as any;
          if (datosCrudos && datosCrudos.uuid_instancia) {
            // Reutiliza de forma segura el ID de sesión anterior
            instanciaEncuestaUuid = datosCrudos.uuid_instancia.split('_')[0];
          }
        }
      }

      await database.write(async () => {
        const capturaCollection = database.collections.get<LocalCaptura>('local_captura');

        const borradoresPrevios = await capturaCollection.query(
          Q.where('id_encuesta', idEncuestaSeguro),
          Q.where('estado_sincro', -1)
        ).fetch();
        const registrosABorrar = borradoresPrevios.map(r => r.prepareDestroyPermanently());

        const batchCreate = Object.entries(respuestas)
          .filter(([_, valor]) => valor !== '') 
          .map(([key, valor]) => {
            const partes = key.split('_');
            const idPregunta = partes[0];
            const uuidFila = partes[1] || null;

            return capturaCollection.prepareCreate((record) => {
              record.id_encuesta = idEncuestaSeguro;
              record.id_pregunta = idPregunta;
              record.valor = valor;
              record.uuid_instancia = uuidFila ? `${instanciaEncuestaUuid}_${uuidFila}` : instanciaEncuestaUuid;
              record.estado_sincro = -1; 
            });
          });

        await database.batch(registrosABorrar.concat(batchCreate));
      });

      setShowPauseModal(false);
      navigation.goBack(); // Regresa al Dashboard de bienvenida sin romper la navegación
    } catch (error) {
      console.error("❌ Error crítico en operación de pausa:", error);
      Alert.alert("Error", "No se pudo suspender la encuesta de forma segura.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalizarFormulario = async () => {
    setIsSaving(true);
    try {
      const instanciaEncuestaUuid = uuid.v4().toString();

      await database.write(async () => {
        const capturaCollection = database.collections.get<LocalCaptura>('local_captura');

        const borradoresPrevios = await capturaCollection.query(
          Q.where('id_encuesta', idEncuestaSeguro),
          Q.where('estado_sincro', -1)
        ).fetch();
        const registrosABorrar = borradoresPrevios.map(r => r.prepareDestroyPermanently());

        const batchCreate = Object.entries(respuestas).map(([key, valor]) => {
          const partes = key.split('_');
          const idPregunta = partes[0];
          const uuidFila = partes[1] || null;

          return capturaCollection.prepareCreate((record) => {
            record.id_encuesta = idEncuestaSeguro;
            record.id_pregunta = idPregunta;
            record.valor = valor;
            record.uuid_instancia = uuidFila ? `${instanciaEncuestaUuid}_${uuidFila}` : instanciaEncuestaUuid;
            record.estado_sincro = 0; 
          });
        });

        await database.batch(registrosABorrar.concat(batchCreate));
      });

      Alert.alert("¡Éxito!", "Gestión completada y lista para enviar.", [{ text: "Finalizar", onPress: () => navigation.goBack() }]);
    } catch (error) {
      Alert.alert("Error", "No se pudo guardar la captura final.");
    } finally {
      setIsSaving(false);
    }
  };

  // --- RESOLUCIÓN Y NORMALIZACIÓN DE CATÁLOGOS CON BUSQUEDA INSENSIBLE ---
  const obtenerOpciones = (opcionesString: string | null): string => {
    if (!opcionesString) return '';

    // Normalizamos el token de búsqueda quitando espacios y el prefijo 'CAT_'
    const strBuscar = opcionesString.toString().trim();
    const tokenLimpio = strBuscar.replace('CAT_', '').toLowerCase();

    // Filtramos buscando coincidencias tanto en el nombre del catálogo como en su código de relación
    const items = catalogos
      .filter(c => {
        const rawCat = c._raw as any;
        const nombreCatBD = (rawCat.nombre_catalogo || '').toString().trim().toLowerCase();
        const codigoCatBD = (rawCat.codigo_catalogo || '').toString().trim().toLowerCase();
        
        // El candado se abre si coincide con el nombre plano, el nombre con CAT_, o el código alfanumérico
        return nombreCatBD === tokenLimpio || 
               nombreCatBD === strBuscar.toLowerCase() ||
               codigoCatBD === tokenLimpio ||
               codigoCatBD === strBuscar.toLowerCase();
      })
      .map(c => (c._raw as any).valor_opcion as string);
      
    return items.length > 0 ? JSON.stringify(items) : '';
  };

  const handleVolverAlInicio = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] }); 
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
          <Text className="text-[#1E3A8A] font-bold text-lg">
            {encuesta ? encuesta.nombre.toUpperCase() : 'CARGANDO FORMULARIO...'}
          </Text>
          <Text className="text-gray-500 text-xs">Formulario Inteligente Offline</Text>
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
              <Text className="text-[#1E3A8A] font-bold text-xs mb-4 ml-2 tracking-widest">
                {seccion.nombre || ((seccion._raw as any).titulo as string) || 'SECCIÓN'}
              </Text>

              {preguntasRaiz.map((p) => {
                if (!isQuestionVisible(p)) return null;

                if (p.tipo_dato?.toUpperCase() === 'MATRIZ') {
                  const preguntasHijas = preguntas.filter(hija => hija.id_matriz_padre === p.id);
                  const filas = instanciasMatriz[p.id] || [];

                  return (
                    <View key={p.id} className="mb-6 bg-blue-50/60 p-4 rounded-[32px] border border-blue-100">
                      <View className="flex-row justify-between items-center mb-4 px-2">
                        <Text className="font-bold text-[#1E3A8A] flex-1 mr-2">{p.etiqueta}</Text>
                        <TouchableOpacity onPress={() => añadirFilaMatriz(p.id)} className="bg-[#1E3A8A] px-4 py-2 rounded-full flex-row items-center shadow-sm">
                          <Feather name="plus" size={16} color="white" />
                          <Text className="text-white font-bold ml-1 text-xs">Añadir</Text>
                        </TouchableOpacity>
                      </View>

                      {filas.map((uuidFila, index) => (
                        <View key={uuidFila} className="bg-white p-5 rounded-[24px] mb-4 shadow-sm border border-gray-200">
                          <View className="flex-row justify-between items-center mb-4 border-b border-gray-100 pb-3">
                            <Text className="text-gray-400 font-black text-[10px] tracking-widest uppercase">REFERENCIA #{index + 1}</Text>
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
                                // ⚡ RESGUARDO DE ENLACE: Si 'opciones' viene vacío, extrae el catálogo desde 'origen_datos_cmd'
                                opciones={obtenerOpciones(hija.opciones || (hija._raw as any).origen_datos_cmd)}
                                onChangeText={(txt) => setRespuestas(prev => ({ ...prev, [`${hija.id}_${uuidFila}`]: txt }))}
                                onBlur={() => { }}
                              />
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  );
                }

                return (
                  <View key={p.id} className="mb-4 bg-white p-5 rounded-[24px] shadow-sm border border-gray-100">
                    <SurveyField
                      tipoDato={p.tipo_dato}
                      etiqueta={p.etiqueta}
                      esObligatorio={p.es_obligatorio === 1}
                      esEditable={p.es_editable === 1}
                      valor={respuestas[p.id] || ''}
                      // ⚡ RESGUARDO DE ENLACE: Aplica el mismo sistema de cruce doble para preguntas de raíz
                      opciones={obtenerOpciones(p.opciones || (p._raw as any).origen_datos_cmd)}
                      onChangeText={(txt) => handleRespuestaChange(p.id, txt)}
                      onBlur={() => { }}
                      mensajeInfo={p.tipo_dato === 'CALCULO' ? "Calculado automáticamente" : undefined}
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

      {/* MODAL PAUSA */}
      <Modal visible={showPauseModal} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-[320px] rounded-[40px] p-10 items-center shadow-2xl">
            <View className="bg-amber-100 p-4 rounded-full mb-4">
              <Feather name="pause-circle" size={48} color="#F59E0B" />
            </View>
            <Text className="text-xl font-bold text-gray-800 text-center">¿Pausar encuesta?</Text>
            <Text className="text-gray-500 text-center mt-3 leading-5">Los datos ingresados se guardarán localmente para continuar después.</Text>
            <View className="flex-row mt-10 gap-3">
              <TouchableOpacity className="flex-1 py-4 bg-gray-50 rounded-2xl border border-gray-200" onPress={() => setShowPauseModal(false)}>
                <Text className="text-center text-gray-600 font-bold">Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity className="flex-1 bg-[#1E3A8A] py-4 rounded-2xl shadow-md" onPress={handlePausarFormulario}>
                <Text className="text-center text-white font-bold">Sí, pausar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const enhance = withObservables(['route'], ({ route }: any) => {
  const idEncuesta = route?.params?.idEncuesta || null;

  return {
    encuesta: idEncuesta ? database.collections.get<LocalEncuesta>('local_encuesta').findAndObserve(idEncuesta) : null,
    secciones: database.collections.get<LocalSeccion>('local_seccion').query(Q.where('id_encuesta', idEncuesta !== null ? idEncuesta : '')),
    preguntas: database.collections.get<LocalEstructuraPregunta>('local_estructura_pregunta').query(Q.where('id_encuesta', idEncuesta !== null ? idEncuesta : '')),
    catalogos: database.collections.get<CatalogoOpcion>('local_catalogo_opciones').query(),
    capturasExistentes: database.collections.get<LocalCaptura>('local_captura').query(
      Q.where('id_encuesta', idEncuesta !== null ? idEncuesta : ''),
      Q.where('estado_sincro', -1)
    ),
  };
});

export const DynamicSurveyScreen = enhance(DynamicSurvey as any);