import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { database } from '../../../data/local/database';
import { Q } from '@nozbe/watermelondb';

import { runFullSync } from '../../../data/local/services/syncManager';
import { useAuthStore } from '../../../presentation/store/useAuthStore'; // <-- VERIFICA ESTA RUTA 
import { BarChart } from 'react-native-chart-kit';
import CatMenuAppex from '../../../data/local/models/CatMenu';
import LocalEncuesta from '../../../data/local/models/LocalEncuesta';
import LocalCaptura from '../../../data/local/models/LocalCaptura';

interface Props {
  menuItems: CatMenuAppex[];
  encuestas: LocalEncuesta[];
  capturas: LocalCaptura[];
  onAbrirEncuesta: (id: string) => void;
}

const Dashboard = ({ menuItems, encuestas, capturas, onAbrirEncuesta }: Props) => {
  const logout = useAuthStore(state => state.logout);
  const userName = useAuthStore(state => state.userName);
  const screenWidth = Dimensions.get("window").width;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

 const estadoCompleto = useAuthStore(state => state);
  React.useEffect(() => {
    console.log("🔍 ESTADO COMPLETO DE ZUSTAND:", estadoCompleto);
  }, []);

  // El sistema maneja el estado para saber qué vista mostrar ('dashboard' | 'sincronizadas')
  const [vistaActual, setVistaActual] = useState<'dashboard' | 'sincronizadas'>('dashboard');

  const itemsRaiz = menuItems.filter(item => !item.id_padre);

  // --- LÓGICA DE ESTADÍSTICAS ---
  // Usamos (c.uuid_instancia || '') para asegurarnos de que nunca sea null antes del split
  const encuestasLlenadas = new Set(
    capturas.map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')
  ).size;
  const capturasPendientes = new Set(
    capturas.filter(c => c.estado_sincro === 0).map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')
  ).size;
  const capturasEnviadas = new Set(
    capturas.filter(c => c.estado_sincro === 1).map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')
  ).size;
  const conteoPorEncuesta: Record<string, number> = {};
  // Extraemos UUIDs únicos
  const uuidsUnicos = Array.from(new Set(capturas.map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')));

  uuidsUnicos.forEach(uuid => {
    const captura = capturas.find(c => c.uuid_instancia?.startsWith(uuid));
    if (captura) {
      const encuestaObj = encuestas.find(e => e.id === captura.id_encuesta);
      // Cortamos el nombre si es muy largo para que quepa en la gráfica
      const nombre = encuestaObj ? encuestaObj.nombre.substring(0, 12) + '...' : 'Otros';
      conteoPorEncuesta[nombre] = (conteoPorEncuesta[nombre] || 0) + 1;
    }
  });

  const chartData = {
    labels: Object.keys(conteoPorEncuesta).length > 0 ? Object.keys(conteoPorEncuesta) : ['Sin datos'],
    datasets: [{
      data: Object.values(conteoPorEncuesta).length > 0 ? Object.values(conteoPorEncuesta) : [0]
    }]
  };
  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await runFullSync();
      Alert.alert("Sincronización Exitosa", "Los datos se han enviado y actualizado correctamente.");
    } catch (error) {
      Alert.alert("Error", "No se pudo sincronizar. Intente de nuevo más tarde.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCerrarSesion = () => {
  // 1. Limpiamos la memoria persistente de Zustand DE VERDAD
  logout(); 
  
  // 2. Cerramos el menú lateral (si lo tienes abierto)
  setIsMenuOpen(false);
  // 3. Opcional: Si usas React Navigation de forma manual
  // navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
};

  return (
    <SafeAreaView className="flex-1 bg-[#F9FAFB]" edges={['top', 'left', 'right']}>
      {/* HEADER */}
      <View className="flex-row items-center justify-between px-4 py-4 bg-white border-b border-gray-200 shadow-sm z-10">
        <View className="flex-row items-center">
          <View className="bg-[#1E3A8A] w-10 h-10 rounded-full items-center justify-center mr-3 shadow-sm">
            <Text className="text-white font-bold">F</Text>
          </View>
          <Text className="text-[#1E3A8A] font-bold text-lg tracking-tight">FUNDEA</Text>
        </View>

        <View className="flex-row items-center">
          <TouchableOpacity onPress={handleManualSync} className="p-2 mr-1">
            <Feather name="refresh-cw" size={22} color="#1E3A8A" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsMenuOpen(true)} className="p-2">
            <Feather name="menu" size={26} color="#374151" />
          </TouchableOpacity>
        </View>
      </View>

      {/* CONTENIDO SCROLLABLE */}

      {vistaActual === 'dashboard' ? (
        <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
          <View className="py-6">
            <Text className="text-2xl font-bold text-gray-800">Panel Principal</Text>
            <Text className="text-gray-500">Novedades y Noticias</Text>
          </View>
          {/* AQUÍ VA TU CÓDIGO ORIGINAL DEL CARRUSEL (NOVEDADES) */}
          <View className="bg-white rounded-3xl h-48 shadow-sm items-center justify-center border border-gray-100">
            <Text className="text-gray-400 font-medium">Carrusel de Novedades Activo</Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          showsVerticalScrollIndicator={false}
          // Añadimos padding abajo para que el botón flotante no tape el contenido final
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          {/* NUEVA CABECERA CON BOTÓN DE REGRESO */}
           <View className="py-6 flex-row items-center">
             <TouchableOpacity 
               onPress={() => setVistaActual('dashboard')} 
               className="mr-4 p-2 bg-white rounded-full shadow-sm border border-gray-100"
             >
               <Feather name="arrow-left" size={24} color="#1E3A8A" />
             </TouchableOpacity>
             <View>
               <Text className="text-2xl font-bold text-[#1E3A8A]">Encuestas Sincronizadas</Text>
               <Text className="text-gray-500">Métricas y envíos pendientes</Text>
             </View>
           </View>
           {/* FIN NUEVA CABECERA */}

          {/* --- TARJETAS DE DASHBOARD CORREGIDAS --- */}
          {/* Solo un flex-row limpio para distribuir las 3 tarjetas */}
          <View className="flex-row justify-between mb-6 gap-3">

            <View className="flex-1 bg-white p-4 rounded-[24px] shadow-sm border border-gray-100 items-center">
              <View className="bg-blue-100 p-3 rounded-full mb-2"><Feather name="file-text" size={20} color="#1E3A8A" /></View>
              <Text className="text-2xl font-black text-gray-800">{encuestasLlenadas}</Text>
              <Text className="text-[10px] text-gray-500 font-bold mt-1 text-center uppercase tracking-wider">Total</Text>
            </View>

            <View className="flex-1 bg-white p-4 rounded-[24px] shadow-sm border border-gray-100 items-center">
              <View className="bg-amber-100 p-3 rounded-full mb-2"><Feather name="cloud" size={20} color="#D97706" /></View>
              <Text className="text-2xl font-black text-gray-800">{capturasPendientes}</Text>
              <Text className="text-[10px] text-gray-500 font-bold mt-1 text-center uppercase tracking-wider">Pendientes</Text>
            </View>

            <View className="flex-1 bg-white p-4 rounded-[24px] shadow-sm border border-gray-100 items-center">
              <View className="bg-green-100 p-3 rounded-full mb-2"><Feather name="check-circle" size={20} color="#059669" /></View>
              <Text className="text-2xl font-black text-gray-800">{capturasEnviadas}</Text>
              <Text className="text-[10px] text-gray-500 font-bold mt-1 text-center uppercase tracking-wider">Enviadas</Text>
            </View>
          </View>
          {/* LUGAR RESERVADO PARA LA GRÁFICA (REACT-NATIVE-CHART-KIT) */}
          <View className="bg-white p-5 rounded-[24px] shadow-sm border border-gray-100 mb-6 items-center">
            <Text className="font-bold text-gray-700 mb-4 w-full">Rendimiento por Encuesta</Text>

            <BarChart
              data={chartData}
              width={screenWidth - 80} // Ajuste dinámico de ancho
              height={240}
              yAxisLabel=""
              yAxisSuffix=""
              fromZero={true}
              chartConfig={{
                backgroundColor: '#ffffff',
                backgroundGradientFrom: '#ffffff',
                backgroundGradientTo: '#ffffff',
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(30, 58, 138, ${opacity})`, // Color azul #1E3A8A
                labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`, // Texto gris
                style: { borderRadius: 16 },
              }}
              style={{ marginVertical: 8, borderRadius: 16 }}
              showValuesOnTopOfBars={true}
            />
          </View>
          {/* Aquí puedes agregar más componentes como la lista de NOVEDADES que tenías antes */}
        </ScrollView>
      )}
      {/* --- BOTÓN FLOTANTE DE ENVÍO DE DATOS --- */}
      {/* Fuera del ScrollView y con position absolute para que siempre esté encima */}
      {capturasPendientes > 0 && (
        <View className="absolute bottom-16 left-0 right-0 px-6">
          <TouchableOpacity
            onPress={handleManualSync}
            activeOpacity={0.8}
            className="bg-[#D97706] p-4 rounded-full flex-row justify-center items-center shadow-lg border border-amber-500"
          >
            <Feather name="upload-cloud" size={24} color="white" />
            <Text className="text-white font-bold ml-3 text-lg">Enviar Datos Pendientes ({capturasPendientes})</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* MODAL DRAWER (MENÚ DINÁMICO) */}
      <Modal visible={isMenuOpen} transparent animationType="fade">
        <View className="flex-1 bg-black/40 flex-row">
          <View className="w-[82%] bg-white h-full shadow-2xl">

            <View className="p-6 bg-[#1E3A8A] pt-16">
              <Text className="text-white font-bold text-2xl">Menú SGRAS</Text>
              {/* Se inyecta el nombre del usuario logueado o un texto por defecto */}
              <Text className="text-blue-200 text-sm mt-1 font-medium">
                Hola, {estadoCompleto.userName || 'Asesor de Campo'}
              </Text>
              <Text className="text-blue-200 text-xs mt-1">FUNDEA Microfinanzas</Text>
            </View>

            <ScrollView className="flex-1 p-4">
              <Text className="text-gray-400 text-[10px] font-bold uppercase mb-3 ml-2 tracking-widest">Navegación</Text>

              {itemsRaiz.map(padre => {
                const hijosBD = menuItems.filter(h => String(h.id_padre) === String(padre.id));
                const esMenuEncuestas = padre.ruta_pantalla === '/encuestas_dinamicas';
                const tieneHijos = hijosBD.length > 0 || (esMenuEncuestas && encuestas.length > 0);

                return (
                  <View key={padre.id} className="mb-2">
                    <TouchableOpacity
                      activeOpacity={0.7}
                      className={`flex-row items-center justify-between p-4 rounded-2xl ${expandedId === padre.id ? 'bg-blue-50' : 'bg-transparent'}`}
                      onPress={() => tieneHijos ? setExpandedId(expandedId === padre.id ? null : padre.id) : null}
                    >
                      <View className="flex-row items-center">
                        <Feather name={(padre.icono as any) || 'folder'} size={20} color={expandedId === padre.id ? "#1E3A8A" : "#6B7280"} />
                        <Text className={`ml-4 font-bold ${expandedId === padre.id ? 'text-[#1E3A8A]' : 'text-gray-700'}`}>{padre.titulo}</Text>
                      </View>
                      {tieneHijos && <Feather name={expandedId === padre.id ? "chevron-up" : "chevron-down"} size={16} color="#9CA3AF" />}
                    </TouchableOpacity>

                    {expandedId === padre.id && tieneHijos && (
                      <View className="ml-10 mt-1 border-l border-gray-100">
                        {hijosBD.map(hijo => (
                          <TouchableOpacity key={hijo.id} className="py-3 px-5 active:bg-gray-50 rounded-r-lg">
                            <Text className="text-gray-600 font-medium">{hijo.titulo}</Text>
                          </TouchableOpacity>
                        ))}

                        {esMenuEncuestas && encuestas.map(enc => (
                          <TouchableOpacity
                            key={enc.id}
                            className="py-4 px-5 active:bg-gray-50 rounded-r-lg flex-row items-center border-b border-gray-50"
                            onPress={() => { setIsMenuOpen(false); onAbrirEncuesta(enc.id); }}
                          >
                            <Feather name="file-plus" size={16} color="#4B5563" />
                            <Text className="text-gray-700 font-medium ml-3 flex-1" numberOfLines={2}>{enc.nombre}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
              <TouchableOpacity
                className="flex-row items-center p-4 rounded-2xl mb-4"
                onPress={() => { setVistaActual('sincronizadas'); setIsMenuOpen(false); }}
              >
                <Feather name="pie-chart" size={20} color="#6B7280" />
                <Text className="ml-4 font-bold text-gray-700">Encuestas Sincronizadas</Text>
              </TouchableOpacity>
            </ScrollView>

            <View className="p-6 border-t border-gray-50">
              <TouchableOpacity
                className="flex-row items-center p-4 bg-red-50 rounded-2xl"
                onPress={() => {

                  Alert.alert("Cerrar Sesión", "¿Está seguro que desea salir?", [
                    { text: "Cancelar", style: 'cancel' },
                    {
                      text: "Salir", style: 'destructive', onPress: () => {
                        handleCerrarSesion;
                      }
                    }
                  ]);
                }}
              >
                <Feather name="log-out" size={20} color="#EF4444" />
                <Text className="ml-3 text-red-600 font-bold">Cerrar Sesión</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setIsMenuOpen(false)} />
        </View>
      </Modal>

      {/* MODAL DE SINCRONIZACIÓN */}
      <Modal visible={isSyncing} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center">
          <View className="bg-white p-10 rounded-[40px] items-center shadow-2xl">
            <ActivityIndicator size="large" color="#1E3A8A" />
            <Text className="text-[#1E3A8A] font-bold mt-6 text-lg">Sincronizando...</Text>
            <Text className="text-gray-400 text-xs mt-2">Enviando y recibiendo datos</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// CONEXIÓN REACTIVA CON WATERMELONDB
const enhance = withObservables([], () => ({
  menuItems: database.collections.get<CatMenuAppex>('cat_menu_appex').query(Q.sortBy('orden', Q.asc)),
  encuestas: database.collections.get<LocalEncuesta>('local_encuesta').query(),
  capturas: database.collections.get<LocalCaptura>('local_captura').query()
}));

export const DashboardScreen = enhance(Dashboard);