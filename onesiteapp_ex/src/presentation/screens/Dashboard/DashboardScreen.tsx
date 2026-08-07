import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import withObservables from '@nozbe/with-observables';
import { database } from '../../../data/local/database';
import { Q } from '@nozbe/watermelondb';
import { useNavigation } from '@react-navigation/native';

import { useSyncMutation } from '../../hooks/useSyncMutation';
import { useAuthStore } from '../../../presentation/store/useAuthStore';
import { BarChart } from 'react-native-chart-kit';
import CatMenuAppex from '../../../data/local/models/CatMenu';
import LocalEncuesta from '../../../data/local/models/LocalEncuesta';
import LocalCaptura from '../../../data/local/models/LocalCaptura';
import LocalClientePendiente from '../../../data/local/models/LocalClientePendiente';
import { leerRaw, type RawUsuarioPerfil } from '../../../data/local/types/raw.types';
import type { NavegacionApp } from '../../navigation/types';
import { DynamicCarousel } from '../DynamicCarousel/DynamicCarouselScreen';
import { contarPendientesDeSubida } from '../../../data/local/services/multimedia.service';

interface Props {
  menuItems: CatMenuAppex[];
  encuestas: LocalEncuesta[];
  capturas: LocalCaptura[];
  clientes: LocalClientePendiente[];
  //onAbrirEncuesta: (id: string) => void;
}

const Dashboard = ({ menuItems, encuestas, capturas, clientes, }: Props) => {
  const navigation = useNavigation<NavegacionApp>();
  const insets = useSafeAreaInsets();
  const logoutAction = useAuthStore(state => state.logout);
  const nombreCompletoStore = useAuthStore(state => state.nombreCompleto);

  // Clientes con la gestión cancelada/eliminada (estado_gestion === 2) no deben contarse en las métricas
  const idsClientesEliminados = new Set(
    clientes.filter(c => c.estado_gestion === 2).map(c => c.id_cliente)
  );

  // El TOTAL no debe contar ni las pausadas (estado_sincro === -1) ni las eliminadas/canceladas
  const capturasValidas = capturas.filter(c =>
    c.estado_sincro >= 0 && !idsClientesEliminados.has((c.uuid_instancia || '').split('_')[0])
  );

  const [nombreDisplay, setNombreDisplay] = useState('Colaborador');
  const [usernameDisplay, setUsernameDisplay] = useState('usuario.fundea');
  const [empresaDisplay, setEmpresaDisplay] = useState('Corporación FUNDEA');
  const [totalRealizadasReal, setTotalRealizadasReal] = useState(0);

  const screenWidth = Dimensions.get("window").width;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // El estado de sincronización lo gobierna TanStack Query (incluye reintentos).
  const sincronizacion = useSyncMutation();
  const isSyncing = sincronizacion.isPending;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [vistaActual, setVistaActual] = useState<'dashboard' | 'sincronizadas'>('dashboard');

  // Permisos del usuario (permisos_json de usuario_perfil) para gatear el menú.
  const [permisosUsuario, setPermisosUsuario] = useState<Set<string>>(new Set());

  /**
   * Regla 3.2 del Anexo 1: un ítem con id_permiso_requerido solo se muestra si ese
   * permiso está en el perfil. Sin permiso requerido (NULL) → visible para todos.
   * Si aún no se cargaron los permisos, se es permisivo para no vaciar el menú.
   */
  const tienePermisoMenu = (item: CatMenuAppex) => {
    const requerido = item.id_permiso_requerido;
    if (!requerido || String(requerido).trim() === '') return true;
    if (permisosUsuario.size === 0) return true;
    return permisosUsuario.has(String(requerido).trim());
  };

  const menuVisible = menuItems.filter(tienePermisoMenu);
  const itemsRaiz = menuVisible.filter(item => !item.id_padre);

  //Casteo estricto para evitar fallos de SQLite (String vs Number)
  const capturasFiltradas = capturasValidas.filter(c => c.uuid_instancia && c.uuid_instancia.trim() !== '');

  // --- PROCESAMIENTO DE MÉTRICAS MÓVILES ---
  const encuestasLlenadas = new Set(
    capturasValidas.map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')
  ).size;

  const capturasPendientes = new Set(
    capturasValidas.filter(c => c.estado_sincro === 0).map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')
  ).size;

  const capturasEnviadas = new Set(
    capturasValidas.filter(c => c.estado_sincro === 1).map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')
  ).size;

  // Gráfico. Emparejamiento estricto de IDs como texto
  const conteoPorEncuesta: Record<string, number> = {};
  const uuidsUnicos = Array.from(new Set(capturasFiltradas.map(c => (c.uuid_instancia || '').split('_')[0]).filter(id => id !== '')));

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
  // La sincronización manual delega en TanStack Query, que aporta los reintentos
  // con retroceso exponencial y expone el estado de carga sin banderas manuales.
  const handleManualSync = () => {
    sincronizacion.mutate(undefined, {
      onSuccess: () => {
        Alert.alert("Sincronización Exitosa", "Los datos se han enviado y actualizado correctamente.");
      },
      onError: () => {
        Alert.alert("Error", "No se pudo sincronizar. Intente de nuevo más tarde.");
      },
    });
  };

  const handleCerrarSesion = () => {
    logoutAction();
    setIsMenuOpen(false);
  };

  // Carga el nombre, el usuario y la empresa desde el almacenamiento seguro.
  useEffect(() => {
    (async () => {
      const nombre = (await SecureStore.getItemAsync('nombre_completo')) || nombreCompletoStore || '';
      const handle = (await SecureStore.getItemAsync('user_name')) || '';
      const empresa = (await SecureStore.getItemAsync('company_name')) || '';
      if (empresa.trim()) setEmpresaDisplay(empresa.trim());

      // Permisos granulares del perfil offline, para gatear el menú (Anexo 1, 3.2).
      try {
        const perfiles = await database.collections.get('usuario_perfil').query().fetch();
        if (perfiles.length > 0) {
          const crudo = leerRaw<RawUsuarioPerfil>(perfiles[0]).permisos_json;
          const parsed: unknown = crudo ? JSON.parse(crudo) : null;
          // Se aceptan tanto un arreglo de ids como un objeto { idPermiso: true }.
          const claves: string[] = Array.isArray(parsed)
            ? parsed.map((x: unknown) => String(x))
            : typeof parsed === 'object' && parsed !== null
              ? Object.entries(parsed as Record<string, unknown>)
                  .filter(([, activo]) => !!activo)
                  .map(([clave]) => clave)
              : [];
          if (claves.length > 0) setPermisosUsuario(new Set(claves));
        }
      } catch (e) {
        console.warn('[PERMISOS] No se pudo leer permisos_json; el menú se muestra completo:', e);
      }
      if (nombre.trim()) setNombreDisplay(nombre.trim());
      if (handle.trim()) {
        setUsernameDisplay(handle.trim());
      } else if (nombre.trim()) {
        // Fallback best-effort para sesiones iniciadas antes de persistir 'user_name'
        // (el handle real aparece tras el próximo login).
        setUsernameDisplay(
          nombre.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.')
        );
      }
    })();
  }, [nombreCompletoStore]);

  useEffect(() => {
    const auditarCatalogosOffline = async () => {
      try {
        if (!database || !database.collections) return;
        const coleccionCatalogos = database.collections.get('local_catalogo_opciones');
        if (!coleccionCatalogos) return;

        await coleccionCatalogos.query().fetchCount();
      } catch (error) {
        console.error("❌ Error leyendo WatermelonDB:", error);
      }
    };
    auditarCatalogosOffline();
  }, []);

  /**
   * Archivos adjuntos que aún no han llegado al servidor.
   *
   * POR QUÉ ESTE INDICADOR ES NECESARIO
   * La encuesta sincronizada NO implica que sus binarios hayan subido: son ciclos
   * independientes, porque una foto de 4 MB puede tardar varios intentos donde la
   * encuesta —unos pocos KB de texto— ya pasó al primero. Sin un indicador visible, el
   * asesor ve "0 pendientes", da su trabajo por terminado y puede liberar espacio o
   * devolver el equipo con evidencia todavía en cola.
   *
   * Se recuenta al enfocar la pantalla en vez de observarse con `withObservables`
   * porque la cola la escribe el sync, no la interfaz: no hay ningún flujo en el que
   * el número cambie mientras el usuario mira esta pantalla sin volver a entrar.
   */
  const [archivosPendientes, setArchivosPendientes] = useState(0);

  useEffect(() => {
    const recuento = async () => {
      try {
        setArchivosPendientes(await contarPendientesDeSubida());
      } catch (error) {
        const detalle = error instanceof Error ? error.message : String(error);
        console.error(`❌ [Multimedia] No se pudo contar los pendientes: ${detalle}`);
      }
    };
    void recuento();
    const quitarListener = navigation.addListener('focus', () => { void recuento(); });
    return quitarListener;
  }, [navigation]);

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
            <Text className="text-sm font-black text-[#1E3A8A] mt-1">{nombreDisplay}</Text>
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
            <Text className="text-[#1E3A8A] text-xl font-black tracking-tight mb-4">Encuestas asignadas</Text>
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
                  onPress={() => navigation.navigate('SurveyClients', { idEncuesta: enc.id })}
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
              <Text className="text-[9px] text-gray-400 font-bold tracking-wider uppercase mt-1">Total encuestas Realizadas</Text>
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

      {/* AVISO DE ARCHIVOS EN COLA — se muestra aunque no queden capturas pendientes,
          que es precisamente el caso peligroso: la encuesta ya se envió y el asesor
          creería que no queda nada por hacer. */}
      {capturasPendientes === 0 && archivosPendientes > 0 && (
        <View
          style={{ bottom: insets.bottom + 16 }}
          className="absolute left-0 right-0 px-6 z-20"
        >
          <TouchableOpacity
            onPress={handleManualSync}
            activeOpacity={0.85}
            className="bg-white p-4 rounded-2xl flex-row justify-center items-center shadow-lg border border-amber-300"
          >
            <Feather name="image" size={20} color="#D97706" />
            <Text className="text-[#B45309] font-bold ml-3 text-base">
              {archivosPendientes} archivo(s) por enviar
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* BOTÓN FLOTANTE MÓVIL PARA ENVÍOS EN SEGUNDO PLANO */}
      {capturasPendientes > 0 && (
        <View
          style={{ bottom: insets.bottom + 16 }} // En un dispositivo moderno se elevará lo justo para no tapar los gestos
          className="absolute left-0 right-0 px-6 z-20"
        >
          <TouchableOpacity
            onPress={handleManualSync}
            activeOpacity={0.85}
            className="bg-[#D97706] p-4 rounded-2xl flex-row justify-center items-center shadow-lg border border-amber-600"
          >
            <Feather name="upload-cloud" size={20} color="white" />
            <Text className="text-white font-bold ml-3 text-base">
              Sincronizar Pendientes ({capturasPendientes})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* COMPONENTE INTERNO DEL MENÚ DESPLEGABLE (DRAWER MODAL) */}
      <Modal visible={isMenuOpen} transparent animationType="fade">
        <View className="flex-1 bg-black/40 flex-row">
          <View className="w-[80%] bg-white h-full shadow-2xl">
            <View className="p-6 bg-[#1E3A8A] pt-16">
              <Text className="text-white font-black text-2xl tracking-tight">SGRAS</Text>
              <Text className="text-blue-50 text-base font-bold leading-5">{nombreDisplay}</Text>
              <Text className="text-blue-200/70 text-xs font-semibold mt-0.5">@{usernameDisplay.toLowerCase()}</Text>
              <Text className="text-blue-200/60 text-xs mt-0.5">{empresaDisplay}</Text>
            </View>

            <ScrollView className="flex-1 p-4">
              <Text className="text-gray-400 text-[10px] font-black uppercase mb-3 ml-2 tracking-widest">Navegación</Text>

              {itemsRaiz.map(padre => {
                // Programación Defensiva. Si el padre id es nulo, evita la comparación.
                // Usamos validación estricta para evitar que undefined rompa WatermelonDB.
                // menuVisible ya está filtrado por permisos, así que los hijos
                // sin permiso tampoco aparecen bajo su padre.
                const hijosBD = menuVisible.filter(h => {
                  if (!h.id_padre) return false;
                  return String(h.id_padre) === String(padre.id);
                });
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
                              navigation.navigate('SurveyClients', { idEncuesta: enc.id });
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

            <View
              style={{
                paddingBottom: Math.max(insets.bottom, 24), // Si es 0 (pantalla vieja), asegura un mínimo de 24px
                paddingHorizontal: 16
              }}
              className="pt-4 border-t border-gray-100">
              <TouchableOpacity
                className="flex-row items-center p-4 bg-red-50 rounded-xl active:bg-red-100 justify-center"
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

      {/* MODAL DE SINCRONIZACIÓN BLOQUEANTE */}
      <Modal visible={isSyncing} transparent animationType="fade">
        <View className="flex-1 bg-black/70 items-center justify-center px-6">
          <View className="bg-white rounded-[32px] p-8 items-center shadow-2xl w-full max-w-[300px]">
            <View className="bg-blue-50 p-4 rounded-full mb-4">
              <ActivityIndicator size="large" color="#1E3A8A" />
            </View>
            <Text className="text-[#1E3A8A] font-black text-xl mt-2 text-center">Sincronizando</Text>
            <Text className="text-gray-500 text-sm text-center mt-3 leading-5">
              Enviando y descargando datos del servidor. Por favor, no cierre la aplicación...
            </Text>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

// ENLACE REACTIVO AUTOMÁTICO CON EL ADAPTADOR SQLITE
const enhance = withObservables([], () => ({
  menuItems: database.collections.get<CatMenuAppex>('cat_menu_appex').query(Q.sortBy('orden', Q.asc)),
  encuestas: database.collections.get<LocalEncuesta>('local_encuesta').query(),
  // Mismo motivo que en SurveyClientsScreen: una Query observada solo avisa cuando
  // cambia el CONJUNTO de filas, no cuando cambia una columna de una fila existente.
  // Las métricas de este panel se calculan sobre `estado_sincro` y `estado_gestion`,
  // que cambian sin que se cree ni se borre ninguna fila: al sincronizar, los
  // contadores de pendientes y enviadas se quedaban congelados hasta salir y volver
  // a entrar a la pantalla.
  capturas: database.collections.get<LocalCaptura>('local_captura')
    .query()
    .observeWithColumns(['estado_sincro', 'uuid_instancia']),
  clientes: database.collections.get<LocalClientePendiente>('local_cliente_pendiente')
    .query()
    .observeWithColumns(['nombre', 'estado_gestion', 'id_cliente']),
}));

export const DashboardScreen = enhance(Dashboard as any);