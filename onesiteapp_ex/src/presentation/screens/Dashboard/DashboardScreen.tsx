import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { database } from '../../../data/local/database';
import { Q } from '@nozbe/watermelondb';

import { runFullSync } from '../../../data/local/services/syncManager';
import { useAuthStore } from '../../../presentation/store/useAuthStore'; // Verifica que tu store esté en esta ruta

import CatMenuAppex from '../../../data/local/models/CatMenu'; 
import LocalEncuesta from '../../../data/local/models/LocalEncuesta';

const NOVEDADES = [
  {
    id: '1',
    categoria: 'CRÉDITO PARA CONSTRUCCIÓN',
    tituloPrincipal: 'Impulsamos la construcción',
    descripcion: 'Apoyamos a nuestros clientes a hacer realidad sus proyectos con condiciones flexibles.',
    imagen: 'https://images.unsplash.com/photo-1504307651254-35680f356fce?q=80&w=800&auto=format&fit=crop',
  }
];

interface Props {
  menuItems: CatMenuAppex[];
  encuestas: LocalEncuesta[];
  onAbrirEncuesta: (id: string) => void;
}

const Dashboard = ({ menuItems, encuestas, onAbrirEncuesta }: Props) => {
  const logout = useAuthStore(state => state.logout);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 1. Filtrado de items Raíz (Los que no tienen padre son el menú principal)
  const itemsRaiz = menuItems.filter(item => !item.id_padre);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await runFullSync();
      Alert.alert("Sincronización", "Datos actualizados correctamente.");
    } catch (error) {
      Alert.alert("Error", "No se pudo sincronizar. Intente de nuevo más tarde.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F9FAFB]" edges={['top', 'left', 'right']}>
      {/* HEADER */}
      <View className="flex-row items-center justify-between px-4 py-4 bg-white border-b border-gray-200 shadow-sm">
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
      <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
        <View className="py-6">
          <Text className="text-2xl font-bold text-gray-800">Panel Principal</Text>
          <Text className="text-gray-500">Gestión de encuestas y expedientes</Text>
        </View>

        {NOVEDADES.map((item) => (
          <View key={item.id} className="bg-white rounded-[24px] mb-6 shadow-sm overflow-hidden border border-gray-100">
            <Image source={{ uri: item.imagen }} className="w-full h-48" resizeMode="cover" />
            <View className="p-5">
              <Text className="text-[#0F172A] font-bold text-lg mb-1">{item.tituloPrincipal}</Text>
              <Text className="text-gray-600 text-sm leading-5">{item.descripcion}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* MODAL DRAWER (MENÚ DINÁMICO) */}
      <Modal visible={isMenuOpen} transparent animationType="fade">
        <View className="flex-1 bg-black/40 flex-row">
          <View className="w-[82%] bg-white h-full shadow-2xl">
            
            <View className="p-6 bg-[#1E3A8A] pt-16">
              <Text className="text-white font-bold text-2xl">Menú SGRAS</Text>
              <Text className="text-blue-200 text-xs mt-1">FUNDEA Microfinanzas</Text>
            </View>

            <ScrollView className="flex-1 p-4">
              <Text className="text-gray-400 text-[10px] font-bold uppercase mb-3 ml-2 tracking-widest">Navegación</Text>
              
              {itemsRaiz.map(padre => {
                const hijos = menuItems.filter(h => String(h.id_padre) === String(padre.id));
                const tieneHijos = hijos.length > 0;

                return (
                  <View key={padre.id} className="mb-2">
                    <TouchableOpacity 
                      activeOpacity={0.7}
                      className={`flex-row items-center justify-between p-4 rounded-2xl ${expandedId === padre.id ? 'bg-blue-50' : 'bg-transparent'}`}
                      onPress={() => tieneHijos ? setExpandedId(expandedId === padre.id ? null : padre.id) : null}
                    >
                      <View className="flex-row items-center">
                        <Feather name={(padre.icono as any) || 'folder'} size={20} color={expandedId === padre.id ? "#1E3A8A" : "#6B7280"} />
                        <Text className={`ml-4 font-bold ${expandedId === padre.id ? 'text-[#1E3A8A]' : 'text-gray-700'}`}>
                          {padre.titulo}
                        </Text>
                      </View>
                      {tieneHijos && (
                        <Feather name={expandedId === padre.id ? "chevron-up" : "chevron-down"} size={16} color="#9CA3AF" />
                      )}
                    </TouchableOpacity>

                    {expandedId === padre.id && tieneHijos && (
                      <View className="ml-10 mt-1 border-l border-gray-100">
                        {hijos.map(hijo => (
                          <TouchableOpacity 
                            key={hijo.id} 
                            className="py-3 px-5 active:bg-gray-50 rounded-r-lg"
                            onPress={() => {
                              if (hijo.ruta_pantalla === '/encuestas/nueva') {
                                // Aquí podrías navegar a una encuesta específica si el ID estuviera en la ruta
                                setIsMenuOpen(false);
                              }
                            }}
                          >
                            <Text className="text-gray-600 font-medium">{hijo.titulo}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}

              <View className="h-8" />

              <Text className="text-gray-400 text-[10px] font-bold uppercase mb-3 ml-2 tracking-widest">Formularios de Campo</Text>
              {encuestas.length === 0 ? (
                <Text className="ml-4 text-gray-400 italic text-xs">No hay encuestas disponibles</Text>
              ) : (
                encuestas.map(enc => (
                  <TouchableOpacity 
                    key={enc.id} 
                    className="flex-row items-center p-4 mb-2 bg-gray-50 rounded-2xl border border-gray-100"
                    onPress={() => { 
                      setIsMenuOpen(false); // Cerramos el menú
                      onAbrirEncuesta(enc.id); // Abrimos la encuesta
                    }}
                  >
                    <View className="bg-blue-100 p-2 rounded-lg">
                      <Feather name="file-text" size={18} color="#1E3A8A" />
                    </View>
                    <Text className="ml-4 text-gray-700 font-bold">{enc.nombre}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <View className="p-6 border-t border-gray-50">
              <TouchableOpacity 
                className="flex-row items-center p-4 bg-red-50 rounded-2xl"
                onPress={() => {
                  Alert.alert("Cerrar Sesión", "¿Está seguro que desea salir?", [
                    { text: "Cancelar", style: 'cancel' },
                    { text: "Salir", style: 'destructive', onPress: () => {
                      setIsMenuOpen(false);
                      logout();
                    }}
                  ]);
                }}
              >
                <Feather name="log-out" size={20} color="#EF4444" />
                <Text className="ml-3 text-red-600 font-bold">Cerrar Sesión</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Backdrop para cerrar al tocar fuera */}
          <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setIsMenuOpen(false)} />
        </View>
      </Modal>

      {/* MODAL DE SINCRONIZACIÓN */}
      <Modal visible={isSyncing} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center">
          <View className="bg-white p-10 rounded-[40px] items-center shadow-2xl">
            <ActivityIndicator size="large" color="#1E3A8A" />
            <Text className="text-[#1E3A8A] font-bold mt-6 text-lg">Sincronizando...</Text>
            <Text className="text-gray-400 text-xs mt-2">Cargando datos locales</Text>
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
}));

export const DashboardScreen = enhance(Dashboard);