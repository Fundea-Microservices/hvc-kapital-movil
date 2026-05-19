import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { database } from '../../../data/local/database';
import { Q } from '@nozbe/watermelondb';
import { useNavigation } from '@react-navigation/native';

import { runFullSync } from '../../../data/local/services/syncManager';
import { useAuthStore } from '../../../presentation/store/useAuthStore';
import { BarChart } from 'react-native-chart-kit';
import CatMenuAppex from '../../../data/local/models/CatMenu';
import LocalEncuesta from '../../../data/local/models/LocalEncuesta';
import LocalCaptura from '../../../data/local/models/LocalCaptura';
import { DynamicCarousel } from '../DynamicCarousel/DynamicCarouselScreen';

interface Props {
  menuItems: CatMenuAppex[];
  encuestas: LocalEncuesta[];
  capturas: LocalCaptura[];
  //onAbrirEncuesta: (id: string) => void;
}

const Dashboard = ({ menuItems, encuestas, capturas, }: Props) => {
  const navigation = useNavigation<any>();
  const logoutAction = useAuthStore(state => state.logout);
  const nombreCompleto = useAuthStore(state => state.nombreCompleto);
  const screenWidth = Dimensions.get("window").width;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [vistaActual, setVistaActual] = useState<'dashboard' | 'sincronizadas'>('dashboard');

  const itemsRaiz = menuItems.filter(item => !item.id_padre);

  // --- PROCESAMIENTO DE MÉTRICAS MÓVILES ---
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
  const uuidsUnicos = Array.from(new Set(capturas.map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')));

  uuidsUnicos.forEach(uuid => {
    const captura = capturas.find(c => c.uuid_instancia?.startsWith(uuid));
    if (captura) {
      const encuestaObj = encuestas.find(e => e.id === captura.id_encuesta);
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

  // --- OPERACIONES DEL SISTEMA ---
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
    logoutAction();
    setIsMenuOpen(false);
  };

  useEffect(() => {
    const auditarCatalogosOffline = async () => {
      try {
        if (!database || !database.collections) return;
        const coleccionCatalogos = database.collections.get('local_catalogo_opciones');
        if (!coleccionCatalogos) return;

        const cantidad = await coleccionCatalogos.query().fetchCount();
        console.log(`📊 [AUDITORÍA OFFLINE]: Tenemos ${cantidad} catálogos listos para usar sin internet.`);
      } catch (error) {
        console.error("❌ Error leyendo WatermelonDB:", error);
      }
    };
    auditarCatalogosOffline();
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-[#F9FAFB]" edges={['top', 'left', 'right']}>

      {/* CABECERA CORPORATIVA DE LA APLICACIÓN */}
      <View className="flex-row items-center justify-between px-6 py-4 bg-white border-b border-gray-100 shadow-sm z-10">
        <View className="flex-row items-center">
          <View className="bg-[#1E3A8A] w-9 h-9 rounded-full items-center justify-center mr-3 shadow-inner">
            <Text className="text-white font-black text-base">F</Text>
          </View>
          <Text className="text-[#1E3A8A] font-black text-xl tracking-tight">FUNDEA</Text>
        </View>

        <View className="flex-row items-center">
          <TouchableOpacity onPress={handleManualSync} className="p-2 mr-1 active:opacity-60">
            <Feather name="refresh-cw" size={20} color="#1E3A8A" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsMenuOpen(true)} className="p-2 active:opacity-60">
            <Feather name="menu" size={24} color="#374151" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ÁREA CENTRAL DE RENDERIZADO DE VISTAS */}
      {vistaActual === 'dashboard' ? (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 140 }}
        >
          {/* MENSAJE DE BIENVENIDA */}
          <View className="px-6 pt-6 pb-4 bg-white border-b border-gray-50">
            <Text className="text-sm font-bold text-[#F59E0B] uppercase tracking-wider">Bienvenido</Text>
            <Text className="text-2xl font-black text-[#1E3A8A] mt-1">
              Hola, {nombreCompleto || 'Colaborador'}
            </Text>
            <Text className="text-gray-500 text-xs mt-2 leading-4">
              Gracias por ser parte del grupo corporativo FUNDEA ¡Que buena idea!
            </Text>
          </View>

          {/* SECCIÓN PARAMETRIZABLE: NOVEDADES Y CARRUSEL */}
          <View className="px-6 mt-6 mb-4 flex-row items-center justify-between">
            <Text className="text-[#1E3A8A] text-xl font-black tracking-tight">Novedades OneSite</Text>
            <TouchableOpacity className="active:opacity-60">
              <Text className="text-[#F59E0B] text-sm font-bold">Ver todo</Text>
            </TouchableOpacity>
          </View>

          {/* EL SISTEMA EJECUTA EL COMPONENTE AUTOMÁTICO DE BANNER */}
          <DynamicCarousel />

          {/* LISTA DINÁMICA DE ENCUESTAS ASIGNADAS AL ASESOR */}
          <View className="px-6 mt-4">
            <Text className="text-[#1E3A8A] text-xl font-black tracking-tight mb-4">Formularios asiganados</Text>
            {encuestas.length === 0 ? (
              <View className="bg-gray-50 p-6 rounded-3xl border border-dashed border-gray-200 items-center">
                <Feather name="folder-minus" size={32} color="#9CA3AF" />
                <Text className="text-gray-400 text-sm mt-2 font-medium">No hay encuestas asignadas a tu rol</Text>
              </View>
            ) : (
              encuestas.map(enc => (
                <TouchableOpacity
                  key={enc.id}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate('DynamicSurvey', { idEncuesta: enc.id })}
                  className="bg-white p-5 rounded-3xl mb-3 border border-gray-100 shadow-sm flex-row items-center justify-between"
                >
                  <View className="flex-row items-center flex-1 pr-4">
                    <View className="bg-blue-50 p-3 rounded-2xl mr-4">
                      <Feather name="file-text" size={20} color="#1E3A8A" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-gray-900 font-bold text-base" numberOfLines={1}>{enc.nombre}</Text>
                      <Text className="text-gray-400 text-xs mt-1">Versión {enc.version_activa}</Text>
                    </View>
                  </View>
                  <Feather name="arrow-right" size={18} color="#1E3A8A" />
                </TouchableOpacity>
              ))
            )}
          </View>
        </ScrollView>
      ) : (
        /* VISTA SECUNDARIA: MÉTRICAS Y HISTORIAL DE ENCUESTAS SINCRONIZADAS */
        <ScrollView
          className="flex-1 px-6"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
        >
          <View className="py-6 flex-row items-center">
            <TouchableOpacity
              onPress={() => setVistaActual('dashboard')}
              className="mr-4 p-3 bg-white rounded-full shadow-sm border border-gray-100"
            >
              <Feather name="arrow-left" size={20} color="#1E3A8A" />
            </TouchableOpacity>
            <View>
              <Text className="text-2xl font-black text-[#1E3A8A]">Auditoría de Capturas</Text>
              <Text className="text-gray-400 text-xs">Métricas consolidadas del dispositivo</Text>
            </View>
          </View>

          {/* INDICADORES EN BLOQUES VERTICALES */}
          <View className="flex-row justify-between mb-6 gap-3">
            <View className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100 items-center">
              <View className="bg-blue-50 p-3 rounded-full mb-2"><Feather name="database" size={18} color="#1E3A8A" /></View>
              <Text className="text-2xl font-black text-gray-900">{encuestasLlenadas}</Text>
              <Text className="text-[10px] text-gray-400 font-bold tracking-wider uppercase mt-1">Total</Text>
            </View>

            <View className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100 items-center">
              <View className="bg-amber-50 p-3 rounded-full mb-2"><Feather name="clock" size={18} color="#D97706" /></View>
              <Text className="text-2xl font-black text-gray-900">{capturasPendientes}</Text>
              <Text className="text-[10px] text-gray-400 font-bold tracking-wider uppercase mt-1">Pendientes</Text>
            </View>

            <View className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100 items-center">
              <View className="bg-green-50 p-3 rounded-full mb-2"><Feather name="check" size={18} color="#059669" /></View>
              <Text className="text-2xl font-black text-gray-900">{capturasEnviadas}</Text>
              <Text className="text-[10px] text-gray-400 font-bold tracking-wider uppercase mt-1">Enviadas</Text>
            </View>
          </View>

          {/* HISTOGRAMA DE PROCESAMIENTO GRÁFICO */}
          <View className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 items-center">
            <Text className="font-bold text-gray-800 text-sm w-full mb-4">Rendimiento por Formulario</Text>
            <BarChart
              data={chartData}
              width={screenWidth - 64}
              height={220}
              yAxisLabel=""
              yAxisSuffix=""
              fromZero={true}
              chartConfig={{
                backgroundColor: '#ffffff',
                backgroundGradientFrom: '#ffffff',
                backgroundGradientTo: '#ffffff',
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(30, 58, 138, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
                style: { borderRadius: 24 },
              }}
              style={{ borderRadius: 24 }}
              showValuesOnTopOfBars={true}
            />
          </View>
        </ScrollView>
      )}

      {/* BOTÓN FLOTANTE MÓVIL PARA ENVÍOS EN SEGUNDO PLANO */}
      {capturasPendientes > 0 && (
        <View className="absolute bottom-6 left-0 right-0 px-6 z-20">
          <TouchableOpacity
            onPress={handleManualSync}
            activeOpacity={0.85}
            className="bg-[#D97706] p-4 rounded-2xl flex-row justify-center items-center shadow-lg border border-amber-600"
          >
            <Feather name="upload-cloud" size={20} color="white" />
            <Text className="text-white font-bold ml-3 text-base">Sincronizar Pendientes ({capturasPendientes})</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* COMPONENTE INTERNO DEL MENÚ DESPLEGABLE (DRAWER MODAL) */}
      <Modal visible={isMenuOpen} transparent animationType="fade">
        <View className="flex-1 bg-black/40 flex-row">
          <View className="w-[80%] bg-white h-full shadow-2xl">
            <View className="p-6 bg-[#1E3A8A] pt-16">
              <Text className="text-white font-black text-2xl tracking-tight">SGRAS</Text>
              <Text className="text-blue-100 text-sm mt-1 font-bold">
                Hola, {nombreCompleto || 'Colaborador'}
              </Text>
              <Text className="text-blue-200/60 text-xs mt-0.5">Corporación FUNDEA</Text>
            </View>

            <ScrollView className="flex-1 p-4">
              <Text className="text-gray-400 text-[10px] font-black uppercase mb-3 ml-2 tracking-widest">Navegación</Text>

              {itemsRaiz.map(padre => {
                // Programación Defensiva. Si el padre id es nulo, evita la comparación.
                // Usamos validación estricta para evitar que undefined rompa WatermelonDB.
                const hijosBD = menuItems.filter(h => {
                  if (!h.id_padre) return false;
                  return String(h.id_padre) === String(padre.id);
                });;
                const esMenuEncuestas = padre.ruta_pantalla === '/encuestas_dinamicas';
                const tieneHijos = hijosBD.length > 0 || (esMenuEncuestas && encuestas.length > 0);

                return (
                  <View key={padre.id} className="mb-1">
                    <TouchableOpacity
                      activeOpacity={0.7}
                      className={`flex-row items-center justify-between p-4 rounded-xl ${expandedId === padre.id ? 'bg-blue-50/50' : 'bg-transparent'}`}
                      onPress={() => tieneHijos ? setExpandedId(expandedId === padre.id ? null : padre.id) : null}
                    >
                      <View className="flex-row items-center">
                        <Feather name={(padre.icono as any) || 'folder'} size={18} color={expandedId === padre.id ? "#1E3A8A" : "#4B5563"} />
                        <Text className={`ml-4 font-bold text-sm ${expandedId === padre.id ? 'text-[#1E3A8A]' : 'text-gray-700'}`}>{padre.titulo}</Text>
                      </View>
                      {tieneHijos && <Feather name={expandedId === padre.id ? "chevron-up" : "chevron-down"} size={14} color="#9CA3AF" />}
                    </TouchableOpacity>

                    {expandedId === padre.id && tieneHijos && (
                      <View className="ml-8 mt-1 border-l-2 border-gray-100 pl-2">
                        {hijosBD.map(hijo => (
                          <TouchableOpacity key={hijo.id} className="py-2.5 px-4 rounded-lg active:bg-gray-50">
                            <Text className="text-gray-600 text-sm font-medium">{hijo.titulo}</Text>
                          </TouchableOpacity>
                        ))}

                        {esMenuEncuestas && encuestas.map(enc => (
                          <TouchableOpacity
                            key={enc.id}
                            activeOpacity={0.7}
                            className="py-3 px-4 rounded-lg flex-row items-center active:bg-gray-50"
                            onPress={() => {
                              setIsMenuOpen(false);
                              navigation.navigate('DynamicSurvey', { idEncuesta: enc.id });
                            }}
                          >
                            <Feather name="edit-3" size={14} color="#4B5563" />
                            <Text className="text-gray-700 text-sm font-semibold ml-3 flex-1" numberOfLines={1}>{enc.nombre}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}

              <TouchableOpacity
                className="flex-row items-center p-4 rounded-xl mt-2 active:bg-gray-50"
                onPress={() => { setVistaActual('sincronizadas'); setIsMenuOpen(false); }}
              >
                <Feather name="pie-chart" size={18} color="#4B5563" />
                <Text className="ml-4 font-bold text-sm text-gray-700">Métricas de Control</Text>
              </TouchableOpacity>
            </ScrollView>

            <View className="p-4 border-t border-gray-100">
              <TouchableOpacity
                className="flex-row items-center p-4 bg-red-50 rounded-xl active:bg-red-100"
                onPress={() => {
                  Alert.alert("Cerrar Sesión", "¿Está seguro que desea salir del sistema?", [
                    { text: "Cancelar", style: 'cancel' },
                    { text: "Salir", style: 'destructive', onPress: handleCerrarSesion }
                  ]);
                }}
              >
                <Feather name="log-out" size={18} color="#EF4444" />
                <Text className="ml-3 text-red-600 font-bold text-sm">Cerrar Sesión</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setIsMenuOpen(false)} />
        </View>
      </Modal>

    </SafeAreaView>
  );
};

// ENLACE REACTIVO AUTOMÁTICO CON EL ADAPTADOR SQLITE
const enhance = withObservables([], () => ({
  menuItems: database.collections.get<CatMenuAppex>('cat_menu_appex').query(Q.sortBy('orden', Q.asc)),
  encuestas: database.collections.get<LocalEncuesta>('local_encuesta').query(),
  capturas: database.collections.get<LocalCaptura>('local_captura').query()
}));

export const DashboardScreen = enhance(Dashboard as any);