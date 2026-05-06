import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Image, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import withObservables from '@nozbe/with-observables';
import { database } from '../../../data/local/database';
import { Q } from '@nozbe/watermelondb';

import { runFullSync } from '../../../data/local/services/syncManager';
import { useAuthStore } from '../../../presentation/store/useAuthStore';

// Modelos Unificados
import CatMenuAppex from '../../../data/local/models/CatMenu';
import LocalEncuesta from '../../../data/local/models/LocalEncuesta';

// --- MOCK DATA PARA LAS NOVEDADES ---
const NOVEDADES = [
  {
    id: '1',
    categoria: 'CRÉDITO PARA CONSTRUCCIÓN',
    tituloPrincipal: 'Impulsamos la construcción',
    tituloImagen: 'Impulsamos la construcción que no terminaste',
    subtituloImagen: 'Tus planes merecen avanzar',
    descripcion: 'Apoyamos a nuestros clientes a hacer realidad sus proyectos de construcción con créditos accesibles y condiciones flexibles.',
    fecha: '14 abr 2026',
    imagen: 'https://images.unsplash.com/photo-1504307651254-35680f356fce?q=80&w=800&auto=format&fit=crop',
    colorAcento: '#F59E0B'
  },
  {
    id: '2',
    categoria: 'CRÉDITO AGRÍCOLA',
    tituloPrincipal: 'Impulsamos la agricultura',
    tituloImagen: 'Tu cosecha merece crecer',
    subtituloImagen: 'Créditos que florecen contigo',
    descripcion: 'Financiamos tus proyectos agrícolas con tasas preferenciales y plazos adaptados a los ciclos de tu cosecha.',
    fecha: '12 abr 2026',
    imagen: 'https://images.unsplash.com/photo-1592982537447-6f2a6a0a5023?q=80&w=800&auto=format&fit=crop',
    colorAcento: '#10B981'
  }
];

interface Props {
  menuItems: CatMenuAppex[]; // CORRECCIÓN: Mismo tipo que inyecta el enhance
  encuestas: LocalEncuesta[];
  onAbrirEncuesta: (id: string) => void;
}

const Dashboard = ({ menuItems, encuestas, onAbrirEncuesta }: Props) => {
  const logout = useAuthStore(state => state.logout);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false); 
  const [expandedSection, setExpandedSection] = useState<string | null>('Gestiones');

  /**
   * Ejecuta la sincronización total y refresca el menú dinámico
   */
  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await runFullSync();
      Alert.alert("Sincronización", "Datos actualizados correctamente.");
    } catch (error) {
      Alert.alert("Error", "No se pudo sincronizar. Verifique su conexión.");
    } finally {
      setIsSyncing(false);
    }
  };

  // Agrupamos los items del menú por sección (Fuerte tipado TS)
  const secciones = Array.from(new Set(menuItems.map(item => item.seccion)));

  return (
    <SafeAreaView className="flex-1 bg-[#F9FAFB]">
      {/* HEADER CON BOTÓN DE SINCRONIZACIÓN */}
      <View className="flex-row items-center justify-between px-4 py-4 bg-white border-b border-gray-200 shadow-sm mt-8">
        <View className="flex-row items-center">
          <View className="bg-[#1E3A8A] w-10 h-10 rounded-full items-center justify-center mr-3">
             <Text className="text-white font-bold">F</Text>
          </View>
          <Text className="text-[#1E3A8A] font-bold text-lg">FUNDEA</Text>
        </View>
        
        <View className="flex-row items-center">
          <TouchableOpacity onPress={handleManualSync} className="p-2 mr-2">
            <Feather name="refresh-cw" size={24} color="#1E3A8A" />
          </TouchableOpacity>
          
          <TouchableOpacity onPress={() => setIsMenuOpen(true)} className="p-2">
            <Feather name="menu" size={28} color="#374151" />
          </TouchableOpacity>
        </View>
      </View>

      {/* --- CONTENIDO PRINCIPAL (SCROLL) --- */}
      <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
        <View className="py-6">
          <Text className="text-2xl font-bold text-gray-800">Panel Principal</Text>
          <Text className="text-gray-500">Gestión de encuestas y expedientes</Text>
        </View>

        <View className="flex-row justify-between items-end mb-4">
          <Text className="text-xl font-bold text-[#0F172A]">Novedades</Text>
          <TouchableOpacity>
            <Text className="text-[#1E3A8A] font-semibold text-sm">Ver todo</Text>
          </TouchableOpacity>
        </View>

        {NOVEDADES.map((item) => (
          <View key={item.id} className="bg-white rounded-[20px] mb-6 shadow-md overflow-hidden border border-gray-100">
            <View className="h-48 relative">
              <Image source={{ uri: item.imagen }} className="w-full h-full" resizeMode="cover" />
              <View className="absolute inset-0 bg-black/40 p-5 justify-end">
                <View style={{ backgroundColor: item.colorAcento }} className="absolute top-4 right-4 w-2 h-8 rounded-full" />
                <Text className="text-white font-bold text-xl mb-1">{item.tituloImagen}</Text>
                <Text className="text-gray-200 text-sm font-medium">{item.subtituloImagen}</Text>
              </View>
            </View>
            <View className="p-5">
              <Text className="text-gray-500 font-bold text-xs mb-2 uppercase tracking-wider">{item.categoria}</Text>
              <Text className="text-[#0F172A] font-bold text-lg mb-3">{item.tituloPrincipal}</Text>
              <Text className="text-gray-600 text-sm leading-relaxed mb-4">{item.descripcion}</Text>
              <Text className="text-gray-400 text-xs">{item.fecha}</Text>
            </View>
          </View>
        ))}
        
        <View className="h-10" /> 
      </ScrollView>

      {/* MODAL DE CARGA DE SINCRONIZACIÓN */}
      <Modal visible={isSyncing} transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center">
          <View className="bg-white p-8 rounded-[32px] items-center shadow-2xl">
            <ActivityIndicator size="large" color="#1E3A8A" />
            <Text className="text-[#1E3A8A] font-bold mt-4">Sincronizando base de datos...</Text>
            <Text className="text-gray-400 text-xs mt-1">Cargando menús y encuestas</Text>
          </View>
        </View>
      </Modal>

      {/* MODAL DE MENÚ LATERAL DINÁMICO */}
      <Modal visible={isMenuOpen} transparent animationType="slide">
        <View className="flex-1 bg-black/50 flex-row">
          <View className="w-[80%] bg-white h-full shadow-2xl">
            
            <View className="p-6 bg-[#1E3A8A] pt-12">
              <Text className="text-white font-bold text-2xl">Menú Principal</Text>
              <Text className="text-blue-200 text-xs">Usuario Autenticado</Text>
            </View>

            <ScrollView className="flex-1 p-4">
              
              {/* 1. SECCIONES DINÁMICAS (Desde cat_menu_appex) */}
              {secciones.map(seccion => (
                <View key={seccion} className="mb-2">
                  <TouchableOpacity 
                    className="flex-row items-center justify-between py-3 px-4 rounded-xl bg-gray-50"
                    onPress={() => setExpandedSection(expandedSection === seccion ? null : seccion)}
                  >
                    <Text className="font-bold text-gray-700">{seccion}</Text>
                    <Feather name={expandedSection === seccion ? "chevron-up" : "chevron-down"} size={16} color="#9CA3AF" />
                  </TouchableOpacity>

                  {expandedSection === seccion && (
                    <View className="pl-4 mt-1">
                      {menuItems
                        .filter(item => item.seccion === seccion)
                        .map(item => (
                          <TouchableOpacity key={item.id} className="flex-row items-center py-3 px-4 active:bg-blue-50 rounded-lg">
                            <Feather name={item.icono as any} size={18} color="#4B5563" />
                            <Text className="ml-3 text-gray-600 font-medium">{item.titulo}</Text>
                          </TouchableOpacity>
                        ))}
                    </View>
                  )}
                </View>
              ))}

              {/* 2. SECCIÓN ESPECIAL: ENCUESTAS (Desde local_encuesta) */}
              <View className="mb-2">
                <TouchableOpacity 
                  className="flex-row items-center justify-between py-3 px-4 rounded-xl bg-blue-50"
                  onPress={() => setExpandedSection(expandedSection === 'ENCUESTAS' ? null : 'ENCUESTAS')}
                >
                  <Text className="font-bold text-[#1E3A8A]">ENCUESTAS DISPONIBLES</Text>
                  <Feather name={expandedSection === 'ENCUESTAS' ? "chevron-up" : "chevron-down"} size={16} color="#1E3A8A" />
                </TouchableOpacity>

                {expandedSection === 'ENCUESTAS' && (
                  <View className="pl-4 mt-1">
                    {encuestas.map(enc => (
                      <TouchableOpacity 
                        key={enc.id} 
                        className="flex-row items-center py-3 px-4"
                        onPress={() => {
                          setIsMenuOpen(false);
                          onAbrirEncuesta(enc.id);
                        }}
                      >
                        <Feather name="file-text" size={18} color="#1E3A8A" />
                        <Text className="ml-3 text-gray-700 font-medium">{enc.nombre}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>

            {/* 3. BOTÓN DE CIERRE DE SESIÓN (ESTRICTO) */}
            <View className="p-6 border-t border-gray-100">
              <TouchableOpacity 
                className="flex-row items-center p-4 bg-red-50 rounded-2xl active:bg-red-100"
                onPress={() => {
                  Alert.alert("Cerrar Sesión", "¿Desea salir del sistema?", [
                    { text: "Cancelar", style: "cancel" },
                    { 
                      text: "Cerrar Sesión", 
                      style: "destructive", 
                      onPress: () => {
                        setIsMenuOpen(false);
                        logout(); 
                      } 
                    }
                  ]);
                }}
              >
                <Feather name="log-out" size={20} color="#EF4444" />
                <Text className="ml-3 text-red-600 font-bold text-lg">Cerrar Sesión</Text>
              </TouchableOpacity>
            </View>

          </View>
          
          <TouchableOpacity className="flex-1" onPress={() => setIsMenuOpen(false)} />
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// --- CONEXIÓN REACTIVA ---
const enhance = withObservables([], () => ({
  menuItems: database.collections.get<CatMenuAppex>('cat_menu_appex').query(Q.sortBy('orden', Q.asc)),
  encuestas: database.collections.get<LocalEncuesta>('local_encuesta').query(),
}));

export const DashboardScreen = enhance(Dashboard);