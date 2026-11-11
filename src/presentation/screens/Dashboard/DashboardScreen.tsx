import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Alert, Dimensions, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
// Feather sigue aquí SOLO para los íconos del menú lateral: sus nombres vienen de
// `cat_menu_appex` (los escribe BackOffice) y son del catálogo de Feather.
import { Feather } from '@expo/vector-icons';
import { ArrowLeftRight, FolderOpen, Mail, MailX, Menu as MenuIcon, RefreshCw } from 'lucide-react-native';
import * as SecureStore from 'expo-secure-store';
import withObservables from '@nozbe/with-observables';
import { database } from '../../../data/local/database';
import { Q } from '@nozbe/watermelondb';
import { useNavigation } from '@react-navigation/native';

import { useSyncMutation } from '../../hooks/useSyncMutation';
import { useLogout } from '../../hooks/useLogout';
import { useUnenroll } from '../../hooks/useUnenroll';
import { DesvincularModal } from '../../components/DesvincularModal';
import { AvatarUsuario } from '../../components/AvatarUsuario';
import { IconoMenu } from '../../components/IconoMenu';
import { mensajeDeError } from '../../../data/remote/types/sync.types';
import { resolverFotoPerfil } from '../../../data/remote/auth.api';
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
import { COLORES } from '../../theme/colores';

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
  const { executeLogout } = useLogout();
  const { executeUnenroll } = useUnenroll();
  const nombreCompletoStore = useAuthStore(state => state.nombreCompleto);

  // Desvinculación del dispositivo (acción destructiva, sin contraseña).
  const [isUnenrollOpen, setIsUnenrollOpen] = useState(false);
  const [unenrollError, setUnenrollError] = useState('');
  const [unenrollLoading, setUnenrollLoading] = useState(false);
  const [pendientesMultimedia, setPendientesMultimedia] = useState(0);

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
  // Rol del perfil offline; vacío mientras no se haya sincronizado.
  const [rolDisplay, setRolDisplay] = useState('');
  const [fotoPerfil, setFotoPerfil] = useState<string | null>(null);
  const [totalRealizadasReal, setTotalRealizadasReal] = useState(0);

  const screenWidth = Dimensions.get("window").width;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // El estado de sincronización lo gobierna TanStack Query (incluye reintentos).
  const sincronizacion = useSyncMutation();
  const isSyncing = sincronizacion.isPending;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Las tres pestañas de la barra inferior + la auditoría, que se abre desde el menú.
  const [vistaActual, setVistaActual] = useState<'dashboard' | 'sincronizadas' | 'mensajes'>('dashboard');

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

  /**
   * Dispatcher de navegación de los ítems HIJO del drawer. Traduce `ruta_pantalla`
   * (definido en el BackOffice, p. ej. `/cambio_password`) a una acción de navegación.
   * Antes los hijos eran puramente decorativos (sin onPress); esto habilita la
   * navegación data-driven para todos. Una ruta no mapeada es un no-op deliberado
   * (mantiene el comportamiento previo para ítems que el BackOffice aún no conecta).
   */
  const RUTAS_MENU_NAVEGABLES = ['/cambio_password'];
  const esRutaNavegable = (ruta?: string | null): boolean =>
    RUTAS_MENU_NAVEGABLES.includes((ruta || '').trim().toLowerCase());

  const navegarPorRutaMenu = (ruta?: string | null): void => {
    switch ((ruta || '').trim().toLowerCase()) {
      case '/cambio_password':
        setIsMenuOpen(false);
        navigation.navigate('CambioPassword', { voluntario: true });
        return;
      default:
        // Ruta no conectada aún (p. ej. la vista "Información del usuario" del
        // BackOffice): no se navega, se conserva el comportamiento decorativo.
        return;
    }
  };

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
    // executeLogout borra las claves de sesión de SecureStore (no solo el estado en
    // memoria) para que al reabrir la app NO se re-loguee con un token huérfano.
    void executeLogout();
    setIsMenuOpen(false);
  };

  // Capturas de encuesta sin subir: pendientes (0) o pausadas (-1). Se perderían con el wipe.
  const capturasSinSubir = capturas.filter(c => c.estado_sincro <= 0).length;

  const abrirDesvincular = async () => {
    setUnenrollError('');
    const n = await contarPendientesDeSubida().catch(() => 0);
    setPendientesMultimedia(n);
    setIsMenuOpen(false);
    setIsUnenrollOpen(true);
  };

  const handleDesvincular = async () => {
    setUnenrollError('');
    setUnenrollLoading(true);
    try {
      // Autoritativo: solo tras el OK del backend se hace el wipe.
      await executeUnenroll();
      // Éxito: wipeData() ya disparó el gate a Enrollment; esta pantalla se desmonta.
    } catch (error) {
      setUnenrollError(mensajeDeError(error, 'No se pudo desvincular el dispositivo'));
      setUnenrollLoading(false);
    }
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
          const perfilCrudo = leerRaw<RawUsuarioPerfil>(perfiles[0]);
          if (perfilCrudo.rol?.trim()) setRolDisplay(perfilCrudo.rol.trim());
          setFotoPerfil(resolverFotoPerfil(perfilCrudo.foto_url));
          const crudo = perfilCrudo.permisos_json;
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
    <SafeAreaView className="flex-1 bg-brand-light" edges={['top', 'left', 'right']}>

      {/* CABECERA CORPORATIVA DE LA APLICACIÓN */}
      <View className="flex-row items-center justify-between px-6 py-3 bg-white border-b border-gray-100 shadow-sm z-10">
        <Image
          source={require('../../../../assets/logo-hvc.png')}
          style={{ width: 160, height: 38 }}
          resizeMode="contain"
        />

        <View className="flex-row items-center">
          <TouchableOpacity onPress={handleManualSync} className="p-2 mr-1 active:opacity-60">
            <RefreshCw size={20} color={COLORES.navy} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsMenuOpen(true)} className="p-2 active:opacity-60">
            <MenuIcon size={24} color={COLORES.navy} />
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
          <View className="px-6 pt-8 pb-6">
            <Text className="text-brand-blue text-[26px] font-inter-bold text-center leading-8">
              ¡Bienvenido,{'\n'}{nombreDisplay}!
            </Text>
          </View>

          {/* EL SISTEMA EJECUTA EL COMPONENTE AUTOMÁTICO DE BANNER */}
          <DynamicCarousel />

          {/* LISTA DINÁMICA DE ENCUESTAS ASIGNADAS AL ASESOR */}
          
        </ScrollView>
      ) : vistaActual === 'mensajes' ? (
        /* MENSAJES: la pantalla existe, el envío todavía no. Estado vacío explícito
           en vez de una bandeja falsa que prometa algo que el backend no hace. */
        <View className="flex-1 items-center justify-center px-10">
          <View className="bg-white w-20 h-20 rounded-full items-center justify-center mb-5 border border-gray-100">
            <MailX size={34} color={COLORES.gray} />
          </View>
          <Text className="text-brand-blue text-xl font-inter-semibold text-center">
            Aún no hay mensajes
          </Text>
          <Text className="text-brand-steel text-sm font-sans text-center mt-2 leading-5">
            Aquí verás los comunicados que te envíe HVC Kapital.
          </Text>
        </View>
      ) : (
        /* MÉTRICAS DE CONTROL: comentada a petición. La pestaña "Emisiones" cae
           aquí, así que necesita algo que dibujar; el JSX original queda abajo.
           Ojo: el comentario NO puede ir entre llaves en esta posición — sería
           un objeto vacío y React revienta con "Objects are not valid as a child". */
        /*<ScrollView
          className="flex-1 px-6"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
        >
          <View className="py-6 flex-row items-center">
            <TouchableOpacity
              onPress={() => setVistaActual('dashboard')}
              className="mr-4 p-3 bg-white rounded-full shadow-sm border border-gray-100"
            >
              <Feather name="arrow-left" size={20} color={COLORES.navy} />
            </TouchableOpacity>
            <View>
              <Text className="text-2xl font-inter-bold text-brand-blue">Auditoría de Capturas</Text>
              <Text className="text-gray-400 text-xs">Métricas consolidadas del dispositivo</Text>
            </View>
          </View>

          {/* INDICADORES EN BLOQUES VERTICALES 
          <View className="flex-row justify-between mb-6 gap-3">
            <View className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100 items-center">
              <View className="bg-blue-50 p-3 rounded-full mb-2"><Feather name="database" size={18} color={COLORES.navy} /></View>
              <Text className="text-2xl font-inter-bold text-gray-900">{encuestasLlenadas}</Text>
              <Text className="text-[10px] text-gray-400 font-inter-semibold tracking-wider uppercase mt-1">Total</Text>
            </View>

            <View className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100 items-center">
              <View className="bg-amber-50 p-3 rounded-full mb-2"><Feather name="clock" size={18} color="#D97706" /></View>
              <Text className="text-2xl font-inter-bold text-gray-900">{capturasPendientes}</Text>
              <Text className="text-[10px] text-gray-400 font-inter-semibold tracking-wider uppercase mt-1">Pendientes</Text>
            </View>

            <View className="flex-1 bg-white p-4 rounded-3xl shadow-sm border border-gray-100 items-center">
              <View className="bg-green-50 p-3 rounded-full mb-2"><Feather name="check" size={18} color="#059669" /></View>
              <Text className="text-2xl font-inter-bold text-gray-900">{capturasEnviadas}</Text>
              <Text className="text-[9px] text-gray-400 font-inter-semibold tracking-wider uppercase mt-1">Total encuestas Realizadas</Text>
            </View>
          </View>

          {/* HISTOGRAMA DE PROCESAMIENTO GRÁFICO 
          <View className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 items-center">
            <Text className="font-inter-semibold text-gray-800 text-sm w-full mb-4">Rendimiento por Formulario</Text>
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
                color: (opacity = 1) => `rgba(7, 23, 55, ${opacity})`,
                labelColor: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
                style: { borderRadius: 24 },
              }}
              style={{ borderRadius: 24 }}
              showValuesOnTopOfBars={true}
            />
          </View>
        </ScrollView>*/
        <View className="flex-1 items-center justify-center px-10">
          <View className="bg-white w-20 h-20 rounded-full items-center justify-center mb-5 border border-gray-100">
            <ArrowLeftRight size={34} color={COLORES.gray} />
          </View>
          <Text className="text-brand-blue text-xl font-inter-semibold text-center">
            Aún no hay emisiones
          </Text>
          <Text className="text-brand-steel text-sm font-sans text-center mt-2 leading-5">
            Aquí verás el detalle de tus emisiones.
          </Text>
        </View>
      )}

      {/* AVISO DE ARCHIVOS EN COLA — se muestra aunque no queden capturas pendientes,
          que es precisamente el caso peligroso: la encuesta ya se envió y el asesor
          creería que no queda nada por hacer. */}
      {capturasPendientes === 0 && archivosPendientes > 0 && (
        <View
          style={{ bottom: insets.bottom + 90 }}
          className="absolute left-0 right-0 px-6 z-20"
        >
          <TouchableOpacity
            onPress={handleManualSync}
            activeOpacity={0.85}
            className="bg-white p-4 rounded-2xl flex-row justify-center items-center shadow-lg border border-amber-300"
          >
            <Feather name="image" size={20} color="#D97706" />
            <Text className="text-[#B45309] font-inter-semibold ml-3 text-base">
              {archivosPendientes} archivo(s) por enviar
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* BOTÓN FLOTANTE MÓVIL PARA ENVÍOS EN SEGUNDO PLANO */}
      {capturasPendientes > 0 && (
        <View
          style={{ bottom: insets.bottom + 90 }} // En un dispositivo moderno se elevará lo justo para no tapar los gestos
          className="absolute left-0 right-0 px-6 z-20"
        >
          <TouchableOpacity
            onPress={handleManualSync}
            activeOpacity={0.85}
            className="bg-[#D97706] p-4 rounded-2xl flex-row justify-center items-center shadow-lg border border-amber-600"
          >
            <Feather name="upload-cloud" size={20} color="white" />
            <Text className="text-white font-inter-semibold ml-3 text-base">
              Sincronizar Pendientes ({capturasPendientes})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* BARRA INFERIOR DE PESTAÑAS.
          "Operaciones" usa flechas de intercambio y NO el ⟳ de la cabecera: ese
          sincroniza, esta navega, y con el mismo ícono se leen como la misma acción. */}
      <View
        style={{ paddingBottom: Math.max(insets.bottom, 10) }}
        className="absolute left-0 right-0 bottom-0 flex-row bg-white border-t border-gray-100 pt-3 z-10"
      >
        {([
          { id: 'dashboard', titulo: 'Inversiones', Icono: FolderOpen },
          { id: 'sincronizadas', titulo: 'Emisiones', Icono: ArrowLeftRight },
          { id: 'mensajes', titulo: 'Mensajes', Icono: Mail },
        ] as const).map(({ id, titulo, Icono }) => {
          const activa = vistaActual === id;
          return (
            <TouchableOpacity
              key={id}
              className="flex-1 items-center active:opacity-60"
              onPress={() => setVistaActual(id)}
            >
              <Icono size={22} color={activa ? COLORES.navy : COLORES.steel} />
              <Text
                className={`text-[11px] mt-1 ${activa ? 'text-brand-navy font-inter-semibold' : 'text-brand-steel font-sans'}`}
              >
                {titulo}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* COMPONENTE INTERNO DEL MENÚ DESPLEGABLE (DRAWER MODAL) */}
      <Modal visible={isMenuOpen} transparent animationType="fade">
        <View className="flex-1 bg-black/40 flex-row">
          <View className="w-[80%] bg-white h-full shadow-2xl">
            {/* Avatar a la izquierda, identidad a la derecha. */}
            <View className="p-6 bg-brand-navy pt-16 flex-row items-center">
              <AvatarUsuario nombre={nombreDisplay} tamano={64} fotoUrl={fotoPerfil} />
              <View className="ml-4 flex-1">
                <Text className="text-white font-inter-bold text-xl tracking-tight">HVC KAPITAL</Text>
                <Text className="text-blue-200/70 text-sm font-inter-semibold mt-0.5">{nombreDisplay}</Text>
                {/* Perfil: por ahora su único destino es el cambio de contraseña.
                    Cuando exista la pantalla de perfil, se cambia este onPress. */}
                <TouchableOpacity
                  onPress={() => {
                    setIsMenuOpen(false);
                    navigation.navigate('CambioPassword', { voluntario: true });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Abrir perfil y cambiar contraseña"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  className="flex-row items-center mt-0.5"
                >
                  <Text className="text-blue-200/70 text-xs font-inter-semibold">Perfil</Text>
                  <Feather name="chevron-right" size={12} color="#BFDBFE" style={{ marginLeft: 2 }} />
                </TouchableOpacity>

                {/*{!!rolDisplay && (
                  <Text className="text-blue-200/70 text-sm font-inter-medium mt-1">{rolDisplay}</Text>
                )}*/}
                {/*<Text className="text-blue-200/70 text-xs font-inter-semibold mt-0.5">@{usernameDisplay.toLowerCase()}</Text>*/}
              </View>
            </View>

            <ScrollView className="flex-1 p-4">
              <Text className="text-gray-400 text-[10px] font-inter-bold uppercase mb-3 ml-2 tracking-widest">Navegación</Text>

              {itemsRaiz.map(padre => {
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
                        <IconoMenu nombre={padre.icono} size={18} color={expandedId === padre.id ? COLORES.navy : COLORES.steel} />
                        <Text className={`ml-4 font-inter-semibold text-sm ${expandedId === padre.id ? 'text-brand-blue' : 'text-gray-700'}`}>{padre.titulo}</Text>
                      </View>
                      {tieneHijos && <Feather name={expandedId === padre.id ? "chevron-up" : "chevron-down"} size={14} color="#9CA3AF" />}
                    </TouchableOpacity>

                    {expandedId === padre.id && tieneHijos && (
                      <View className="ml-8 mt-1 border-l-2 border-gray-100 pl-2">
                        {hijosBD.map(hijo => (
                          <TouchableOpacity
                            key={hijo.id}
                            activeOpacity={0.7}
                            className="py-2.5 px-4 rounded-lg active:bg-gray-50 flex-row items-center justify-between"
                            onPress={() => navegarPorRutaMenu(hijo.ruta_pantalla)}
                          >
                            <View className="flex-row items-center flex-1">
                              {hijo.icono && <IconoMenu nombre={hijo.icono} size={14} color="#4B5563" />}
                              <Text className={`text-gray-600 text-sm font-medium ${hijo.icono ? 'ml-3' : ''}`} numberOfLines={1}>{hijo.titulo}</Text>
                            </View>
                            {esRutaNavegable(hijo.ruta_pantalla) && (
                              <Feather name="chevron-right" size={14} color="#9CA3AF" />
                            )}
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

              {/* MÉTRICAS DE CONTROL: comentada junto con su vista.
              <TouchableOpacity
                className="flex-row items-center p-4 rounded-xl mt-2 active:bg-gray-50"
                onPress={() => { setVistaActual('sincronizadas'); setIsMenuOpen(false); }}
              >
                <Feather name="pie-chart" size={18} color="#4B5563" />
                <Text className="ml-4 font-inter-semibold text-sm text-gray-700">Métricas de Control</Text>
              </TouchableOpacity>
              */}
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
                <Text className="ml-3 text-red-600 font-inter-semibold text-sm">Cerrar Sesión</Text>
              </TouchableOpacity>

              {/* Acción destructiva de menor frecuencia: desvincula el equipo (des-enrola). */}
              {/*<TouchableOpacity
                className="flex-row items-center justify-center py-3 mt-1 active:opacity-70"
                onPress={abrirDesvincular}
              >
                <Feather name="slash" size={14} color="#9CA3AF" />
                {/*<Text className="ml-2 text-gray-400 font-semibold text-xs">Eliminar registro</Text>
              </TouchableOpacity>*/}
            </View>
          </View>
          <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setIsMenuOpen(false)} />
        </View>
      </Modal>

      {/* MODAL DE DESVINCULACIÓN (destructivo, exige contraseña) */}
      <DesvincularModal
        visible={isUnenrollOpen}
        error={unenrollError}
        loading={unenrollLoading}
        capturasSinSubir={capturasSinSubir}
        pendientesMultimedia={pendientesMultimedia}
        onConfirmar={handleDesvincular}
        onCancelar={() => setIsUnenrollOpen(false)}
      />

      {/* MODAL DE SINCRONIZACIÓN BLOQUEANTE */}
      <Modal visible={isSyncing} transparent animationType="fade">
        <View className="flex-1 bg-black/70 items-center justify-center px-6">
          <View className="bg-white rounded-[32px] p-8 items-center shadow-2xl w-full max-w-[300px]">
            <View className="bg-blue-50 p-4 rounded-full mb-4">
              <ActivityIndicator size="large" color={COLORES.navy} />
            </View>
            <Text className="text-brand-blue font-inter-bold text-xl mt-2 text-center">Sincronizando</Text>
            <Text className="text-gray-500 text-sm text-center mt-3 leading-5">
              Enviando y descargando datos del servidor. Por favor, no cierre la aplicación...
            </Text>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

// ENLACE REACTIVO AUTOMÁTICO CON EL ADAPTADOR SQLITE @
const enhance = withObservables([], () => ({
  menuItems: database.collections.get<CatMenuAppex>('cat_menu_appex').query(Q.sortBy('orden', Q.asc)),
  encuestas: database.collections.get<LocalEncuesta>('local_encuesta').query(),
  capturas: database.collections.get<LocalCaptura>('local_captura')
    .query()
    .observeWithColumns(['estado_sincro', 'uuid_instancia']),
  clientes: database.collections.get<LocalClientePendiente>('local_cliente_pendiente')
    .query()
    .observeWithColumns(['nombre', 'estado_gestion', 'id_cliente']),
}));

export const DashboardScreen = enhance(Dashboard as any);