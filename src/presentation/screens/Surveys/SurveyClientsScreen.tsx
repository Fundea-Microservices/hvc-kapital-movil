import React, { useMemo, useState } from 'react';
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
import { filtrarClientes, contarPendientes, soloPendientes } from '../../../domain/agenda/busqueda';
import { recortarMotivo, MAX_LONGITUD_MOTIVO, ENVIO_PENDIENTE } from '../../../domain/agenda/rechazo';
import { useValorPospuesto } from '../../hooks/useValorPospuesto';
import { useCargarClientesAsignados } from '../../hooks/useCargarClientesAsignados';
import { agendaConfigurada } from '../../../core/network/apiClient';
import { BuscadorClientes } from '../../components/Surveys/BuscadorClientes';
import { TarjetaCliente } from '../../components/Surveys/TarjetaCliente';
import { BotonCargarDatos, type EstadoCarga } from '../../components/Surveys/BotonCargarDatos';
// @ts-ignore
import uuid from 'react-native-uuid';

interface Props {
  clientes: LocalClientePendiente[];
  encuesta: LocalEncuesta | null;
  route: RutaDe<'SurveyClients'>;
}

const SurveyClients = ({ clientes, encuesta, route }: Props) => {
  const navigation = useNavigation<NavegacionApp>();
  const [selectedCliente, setSelectedCliente] = useState<LocalClientePendiente | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [consulta, setConsulta] = useState('');

  const idEncuesta = route?.params?.idEncuesta || '';

  // El input se pinta con el valor inmediato; solo el FILTRADO se pospone, de forma que
  // el texto y el cursor responden al instante aunque la cartera sea grande.
  const consultaAplicada = useValorPospuesto(consulta, 250);

  const cargarDatos = useCargarClientesAsignados(idEncuesta);

  // Las completadas se ocultan para no saturar la lista; el recuento total se conserva
  // porque es lo que distingue "ruta terminada" de "sin cartera".
  const visibles = useMemo(
    () => filtrarClientes(soloPendientes(clientes), consultaAplicada),
    [clientes, consultaAplicada],
  );
  const pendientes = useMemo(() => contarPendientes(clientes), [clientes]);
  const completadas = clientes.length - pendientes;

  const hayBusqueda = consultaAplicada.trim() !== '';

  /** Traduce el estado de la mutación al estado visual del botón. */
  const estadoCarga: EstadoCarga = !agendaConfigurada()
    ? 'sin_configurar'
    : cargarDatos.isPending
      ? 'cargando'
      : cargarDatos.isError
        ? 'sin_red'
        : cargarDatos.isSuccess
          ? cargarDatos.data.ok
            ? 'exito'
            : cargarDatos.data.motivo === 'SIN_CONFIGURAR'
              ? 'sin_configurar'
              : cargarDatos.data.motivo === 'OCUPADO'
                ? 'ocupado'
                : 'error'
          : 'reposo';

  // El mensaje refleja lo que el asesor VE en la agenda, no cuántas filas mandó el
  // servidor. `recibidos` cuenta todo lo devuelto (incluidas las que el asesor canceló,
  // que el servidor sigue enviando como CARGADO pero aquí quedan ocultas por
  // estado_gestion=2): mostrar ese número dejaba "6 actualizados" junto a 5 tarjetas.
  // Se reporta el número de pendientes, que es exactamente el de tarjetas a la vista.
  const mensajeCarga =
    estadoCarga === 'exito' && cargarDatos.data
      ? `Agenda actualizada · ${pendientes} pendiente(s)`
      : null;

  const handleCrearEncuestaAdHoc = () => {
    const nuevoUuidInstancia = uuid.v4().toString();

    navigation.navigate('DynamicSurvey', {
      idEncuesta: idEncuesta,
      uuidInstanciaBase: nuevoUuidInstancia,
      idCliente: null,
    });
  };

  const handleContinuarCliente = (cliente: LocalClientePendiente) => {
    navigation.navigate('DynamicSurvey', {
      idEncuesta: idEncuesta,
      uuidInstanciaBase: cliente.id_cliente,
      idCliente: cliente.id_cliente,
    });
  };

  const handleProcesarCancelar = async () => {
    if (!motivoCancelacion.trim()) return;

    try {
      if (selectedCliente) {
        await database.write(async () => {
          await selectedCliente.update((record) => {
            record.estado_gestion = 2;
            record.motivo_rechazo = recortarMotivo(motivoCancelacion);
            /**
             * La cancelación sigue siendo LOCAL E INMEDIATA: aquí solo se encola.
             * El envío lo hace `empujarRechazosPendientes` en el próximo sync, así que
             * el asesor no espera red ni se le puede negar la cancelación por no tenerla.
             *
             * El uuid se genera AHORA y no al enviar: es la clave de idempotencia del
             * servidor y debe ser la misma en todos los reintentos.
             */
            record.rechazo_uuid = uuid.v4().toString();
            record.rechazo_envio_estado = ENVIO_PENDIENTE;
            record.rechazo_intentos = 0;
            record.rechazo_ultimo_error = null;
            record.rechazo_fecha = Date.now();
            record.rechazo_fecha_envio = null;
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

  /**
   * Tres estados vacíos distintos, y cada uno dice algo diferente al asesor.
   *
   * "Ruta completada" solía ser el estado por DEFECTO —salía también cuando el asesor
   * simplemente no tenía cartera descargada—, que es justo lo que este sprint corrige.
   * Solo aparece cuando de verdad hay clientes y ninguno queda pendiente. Como las
   * completadas ya no se listan, en ese caso la lista queda vacía y el mensaje ocupa
   * su lugar en vez de ir de cabecera.
   */
  const renderVacio = () => {
    if (hayBusqueda) {
      return (
        <View className="items-center justify-center py-16">
          <Feather name="search" size={44} color="#9CA3AF" />
          <Text className="text-gray-500 font-bold mt-4 text-center px-8">
            Sin resultados para «{consultaAplicada.trim()}».
          </Text>
          <TouchableOpacity onPress={() => setConsulta('')} className="mt-4 px-5 py-2 rounded-xl bg-gray-100">
            <Text className="text-gray-600 font-bold text-sm">Limpiar búsqueda</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (clientes.length > 0 && pendientes === 0) {
      return (
        <View className="items-center justify-center py-16">
          <Feather name="check-circle" size={48} color="#1E3A8A" />
          <Text className="text-[#1E3A8A] font-bold mt-4">¡Felicidades! Ruta completada.</Text>
          <Text className="text-gray-400 text-xs mt-1 text-center px-10">
            {completadas} encuesta(s) terminada(s) en esta agenda.
          </Text>
        </View>
      );
    }

    return (
      <View className="items-center justify-center py-16">
        <Feather name="inbox" size={48} color="#9CA3AF" />
        <Text className="text-gray-500 font-bold mt-4">Sin clientes asignados.</Text>
        <Text className="text-gray-400 text-xs mt-1 text-center px-10">
          Pulse «Cargar datos» para traer su cartera de esta encuesta.
        </Text>
      </View>
    );
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
          <Text className="text-gray-400 text-xs">Encuesta Offline</Text>
        </View>
        <TouchableOpacity
          onPress={handleCrearEncuestaAdHoc}
          className="bg-[#1E3A8A] p-2.5 rounded-full shadow-md"
        >
          <Feather name="plus" size={22} color="white" />
        </TouchableOpacity>
      </View>

      <View className="px-4 pt-4 pb-1 bg-gray-50">
        <BotonCargarDatos
          estado={estadoCarga}
          onPress={() => cargarDatos.mutate()}
          mensaje={mensajeCarga}
        />
        <View className="mt-3">
          <BuscadorClientes valor={consulta} onCambiar={setConsulta} />
        </View>
        {clientes.length > 0 && (
          <Text className="text-gray-400 text-[11px] mt-2 ml-1">
            {pendientes} pendiente(s) · {completadas} completada(s)
          </Text>
        )}
      </View>

      <FlatList
        data={visibles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: 8 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={renderVacio()}
        renderItem={({ item }) => (
          <TarjetaCliente
            cliente={item}
            expandido={selectedCliente?.id === item.id}
            onAlternar={() => setSelectedCliente(selectedCliente?.id === item.id ? null : item)}
            onContinuar={() => handleContinuarCliente(item)}
            onCancelar={() => {
              setSelectedCliente(item);
              setShowCancelModal(true);
            }}
          />
        )}
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
              /* Tope en la entrada, no solo al guardar: el motivo se persiste en
                 columnas NVARCHAR acotadas del servidor, y pasarse provoca un fallo de
                 truncamiento dentro de la transacción. Cortar en silencio lo que el
                 asesor ya escribió es peor que no dejarle escribir más. */
              maxLength={MAX_LONGITUD_MOTIVO}
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
     * columna nueva a la tarjeta obliga a añadirla también aquí. `motivo_rechazo` y
     * `valores_json` quedan fuera a propósito: no se pintan en ninguna tarjeta.
     *
     * La consulta sigue trayendo el estado 1 (Completado) aunque la lista ya no lo
     * pinte: sin esas filas no se podría distinguir "ruta terminada" de "sin cartera".
     * Se ocultan en la pantalla con `soloPendientes`. Los cancelados (2) quedan fuera.
     */
    clientes: database.collections.get<LocalClientePendiente>('local_cliente_pendiente').query(
      Q.where('id_encuesta', idEncuesta),
      Q.where('estado_gestion', Q.oneOf([0, 1]))
    ).observeWithColumns([
      'nombre',
      'codigo',
      'estado_gestion',
      'origen',
      'documento',
      'cuenta',
      'operacion',
      'expediente',
      'ubicacion',
      'busqueda_normalizada',
      'estado_servidor',
    ]),
  };
});

export const SurveyClientsScreen = enhance(SurveyClients);
