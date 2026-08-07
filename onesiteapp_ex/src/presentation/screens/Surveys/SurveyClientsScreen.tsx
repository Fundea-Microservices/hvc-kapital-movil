import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { database } from '../../../data/local/database';
import { Q } from '@nozbe/watermelondb';
import LocalClientePendiente from '../../../data/local/models/LocalClientePendiente';
import LocalEncuesta from '../../../data/local/models/LocalEncuesta';
import { useNavigation } from '@react-navigation/native';
import type { NavegacionApp, RutaDe } from '../../navigation/types';
// @ts-ignore
import uuid from 'react-native-uuid';

interface Props {
  clientes: LocalClientePendiente[];
  encuesta: LocalEncuesta | null; // 
  route: RutaDe<'SurveyClients'>;
}

const SurveyClients = ({ clientes, encuesta, route }: Props) => {
  const navigation = useNavigation<NavegacionApp>();
  const [selectedCliente, setSelectedCliente] = useState<LocalClientePendiente | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');

  const idEncuesta = route?.params?.idEncuesta || '';

  const handleCrearEncuestaAdHoc = () => {
    const nuevoUuidInstancia = uuid.v4().toString();
    
    navigation.navigate('DynamicSurvey', {
      idEncuesta: idEncuesta,
      uuidInstanciaBase: nuevoUuidInstancia, 
      idCliente: null
    });
  };

  const handleContinuarCliente = (cliente: LocalClientePendiente) => {
    navigation.navigate('DynamicSurvey', {
      idEncuesta: idEncuesta,
      uuidInstanciaBase: cliente.id_cliente, 
      idCliente: cliente.id_cliente
    });
  };

  const handleProcesarCancelar = async () => {
    if (!motivoCancelacion.trim()) return;

    try {
      if (selectedCliente) {
        await database.write(async () => {
          await selectedCliente.update((record) => {
            record.estado_gestion = 2; 
            record.motivo_rechazo = motivoCancelacion;
          });
        });
      }
      setShowCancelModal(false);
      setMotivoCancelacion('');
      setSelectedCliente(null);
    } catch (error) {
      console.error('❌ Error al cancelar la gestión del cliente:', error);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      {/* HEADER DE RUTA PARAMETRIZABLE */}
      <View className="flex-row items-center justify-between px-5 py-4 bg-white border-b border-gray-200">
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={24} color="#374151" />
        </TouchableOpacity>
        <View className="flex-1 ml-3">
          {/*Se concatena el nombre dinámico del BackOffice */}
          <Text className="text-[#1E3A8A] font-black text-lg">
            AGENDA {encuesta ? encuesta.nombre.toUpperCase() : 'PENDIENTES'}
          </Text>
          <Text className="text-gray-400 text-xs">Formulario Inteligente Offline</Text>
        </View>
        <TouchableOpacity 
          onPress={handleCrearEncuestaAdHoc}
          className="bg-[#1E3A8A] p-2.5 rounded-full shadow-md"
        >
          <Feather name="plus" size={22} color="white" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={clientes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View className="items-center justify-center py-20">
            <Feather name="check-circle" size={48} color="#1E3A8A" />
            <Text className="text-gray-500 font-bold mt-4">¡Felicidades! Ruta completada.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = selectedCliente?.id === item.id;
          return (
            <View className="bg-white rounded-3xl p-5 mb-3 border border-orange-200 shadow-sm">
              <View className="flex-row justify-between items-center">
                <View className="flex-1 pr-3">
                  <Text className="text-gray-400 text-[10px] font-black uppercase tracking-wider">
                    {item.codigo === 'AD-HOC' ? 'CREADO EN CAMPO' : `CÓDIGO: ${item.codigo}`}
                  </Text>
                  <Text className="text-gray-800 font-bold text-base mt-0.5">{item.nombre}</Text>
                </View>
                <TouchableOpacity 
                  onPress={() => setSelectedCliente(isSelected ? null : item)}
                  className={`p-2 rounded-full ${isSelected ? 'bg-blue-50' : 'bg-gray-50'}`}
                >
                  <Feather name={isSelected ? "chevron-up" : "chevron-down"} size={20} color="#1E3A8A" />
                </TouchableOpacity>
              </View>

              {isSelected && (
                <View className="flex-row gap-3 mt-4 pt-4 border-t border-blue-500">
                  <TouchableOpacity 
                    onPress={() => setShowCancelModal(true)}
                    className="flex-1 py-3 bg-[#F59E0B] rounded-xl border border-red-100"
                  >
                    <Text className="text-center text-white font-bold text-sm">Cancelar Gestión</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={() => handleContinuarCliente(item)}
                    className="flex-1 py-3 bg-[#1E3A8A] rounded-xl shadow-sm"
                  >
                    <Text className="text-center text-white font-bold text-sm">Continuar</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
      />

      <Modal visible={showCancelModal} transparent animationType="slide">
        <View className="flex-1 bg-black/60 items-center justify-center px-6">
          <View className="bg-white w-full max-w-[340px] rounded-[32px] p-6 shadow-2xl">
            <Text className="text-lg font-black text-gray-800 text-center">Motivo de Cancelación</Text>
            <Text className="text-gray-400 text-xs text-center mt-1 leading-4">Escriba detalladamente la justificación por la cual no se realizará la encuesta.</Text>
            
            <TextInput
              multiline 
              numberOfLines={4}
              placeholder="Ej. Cliente se mudó de localidad..."
              value={motivoCancelacion}
              onChangeText={setMotivoCancelacion}
              className="w-full border border-gray-200 rounded-2xl p-4 mt-4 text-gray-700 bg-gray-50 text-sm align-top"
              style={{ textAlignVertical: 'top' }}
            />

            <View className="flex-row mt-5 gap-3">
              <TouchableOpacity 
                className="flex-1 py-3 bg-gray-100 rounded-xl" 
                onPress={() => { setShowCancelModal(false); setMotivoCancelacion(''); }}
              >
                <Text className="text-center text-gray-500 font-bold text-sm">Cerrar</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                disabled={!motivoCancelacion.trim()}
                className={`flex-1 py-3 rounded-xl ${motivoCancelacion.trim() ? 'bg-[#1E3A8A]' : 'bg-gray-300'}`}
                onPress={handleProcesarCancelar}
              >
                <Text className="text-center text-white font-bold text-sm">Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// ACOPLAMIENTO REACTIVO MULTIPLE CON SUBSCRIPCIÓN DE LA ENCUESTA PADRE
const enhance = withObservables(['route'], ({ route }: any) => {
  const idEncuesta = route?.params?.idEncuesta || '';

  return {
    // El sistema observa el registro de la encuesta para extraer su nombre en tiempo real
    encuesta: database.collections.get<LocalEncuesta>('local_encuesta').findAndObserve(idEncuesta),
    /**
     * `observeWithColumns` y NO `.query()` a secas.
     *
     * Una Query observada emite solo cuando cambia el CONJUNTO de filas que cumplen
     * el criterio: altas, bajas o registros que entran/salen del filtro. Modificar una
     * COLUMNA de una fila que ya estaba —renombrar la tarjeta de "NUEVA ENCUESTA" al
     * nombre real al pausar— no altera ese conjunto, así que no emitía nada y la
     * lista se quedaba con el texto anterior.
     *
     * El síntoma delator era que el nombre aparecía "al tocar": el toque cambia el
     * estado del acordeón, la pantalla se vuelve a renderizar y lee el modelo, que en
     * memoria ya estaba actualizado. Los datos siempre fueron correctos; lo que
     * faltaba era el aviso de que habían cambiado.
     *
     * Se declaran las columnas que la lista MUESTRA o usa para filtrar. Añadir una
     * columna nueva a la tarjeta obliga a añadirla también aquí.
     */
    clientes: database.collections.get<LocalClientePendiente>('local_cliente_pendiente').query(
      Q.where('id_encuesta', idEncuesta),
      Q.where('estado_gestion', 0)
    ).observeWithColumns(['nombre', 'codigo', 'estado_gestion']),
  };
});

export const SurveyClientsScreen = enhance(SurveyClients);