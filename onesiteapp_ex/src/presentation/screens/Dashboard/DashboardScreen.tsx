import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLogout } from '../../hooks/useLogout';

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
    // Usamos imágenes de placeholder, en producción vendrán de la API
    imagen: 'https://images.unsplash.com/photo-1504307651254-35680f356fce?q=80&w=800&auto=format&fit=crop',
    colorAcento: '#F59E0B' // Naranja
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
    colorAcento: '#10B981' // Verde
  }
];

export const DashboardScreen = () => {
  const { executeLogout } = useLogout();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // Estado para el acordeón del menú lateral
  const [expandedSection, setExpandedSection] = useState<string | null>('Gestiones');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <SafeAreaView className="flex-1 bg-[#F9FAFB]">
      {/* --- HEADER --- */}
      <View className="flex-row items-center justify-between px-4 py-4 bg-white border-b border-gray-200 shadow-sm mt-8">
        <View className="flex-row items-center">
          <View className="bg-[#1E3A8A] w-12 h-12 rounded-full items-center justify-center mr-3">
            <Text className="text-white font-bold text-xl">F</Text>
          </View>
          <View>
            <Text className="text-[#1E3A8A] font-bold text-lg tracking-wide">FUNDEA</Text>
            <Text className="text-gray-500 text-xs">Microfinanzas</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => setIsMenuOpen(true)} className="p-2">
          <Feather name="menu" size={28} color="#374151" />
        </TouchableOpacity>
      </View>

      {/* --- CONTENIDO PRINCIPAL (SCROLL) --- */}
      <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
        {/* Sección Bienvenida */}
        <View className="mt-6 mb-6">
          <Text className="text-3xl font-extrabold text-[#0F172A] mb-2">Bienvenido</Text>
          <Text className="text-gray-600 text-base">Gracias por ser parte del grupo corporativo FUNDEA</Text>
        </View>

        {/* Sección Novedades (Header) */}
        <View className="flex-row justify-between items-end mb-4">
          <Text className="text-xl font-bold text-[#0F172A]">Novedades</Text>
          <TouchableOpacity>
            <Text className="text-[#1E3A8A] font-semibold text-sm">Ver todo</Text>
          </TouchableOpacity>
        </View>

        {/* Lista de Tarjetas (Carrusel Vertical) */}
        {NOVEDADES.map((item) => (
          <View key={item.id} className="bg-white rounded-[20px] mb-6 shadow-md overflow-hidden border border-gray-100">
            {/* Imagen con Overlay */}
            <View className="h-48 relative">
              <Image source={{ uri: item.imagen }} className="w-full h-full" resizeMode="cover" />
              <View className="absolute inset-0 bg-black/40 p-5 justify-end">
                {/* Píldora de color decorativa */}
                <View style={{ backgroundColor: item.colorAcento }} className="absolute top-4 right-4 w-2 h-8 rounded-full" />
                <Text className="text-white font-bold text-xl mb-1">{item.tituloImagen}</Text>
                <Text className="text-gray-200 text-sm font-medium">{item.subtituloImagen}</Text>
              </View>
            </View>

            {/* Cuerpo de la tarjeta */}
            <View className="p-5">
              <Text className="text-gray-500 font-bold text-xs mb-2 uppercase tracking-wider">{item.categoria}</Text>
              <Text className="text-[#0F172A] font-bold text-lg mb-3">{item.tituloPrincipal}</Text>
              <Text className="text-gray-600 text-sm leading-relaxed mb-4">{item.descripcion}</Text>
              <Text className="text-gray-400 text-xs">{item.fecha}</Text>
            </View>
          </View>
        ))}
        
        {/* Espaciado final */}
        <View className="h-10" /> 
      </ScrollView>

      {/* --- MENÚ LATERAL (DRAWER CUSTOM MODAL) --- */}
      <Modal visible={isMenuOpen} transparent animationType="fade" onRequestClose={() => setIsMenuOpen(false)}>
        <View className="flex-1 bg-black/50 flex-row">
          
          {/* Panel del Menú (Blanco) */}
          <View className="w-[80%] max-w-[320px] bg-white h-full shadow-2xl">
            {/* Header del Menú */}
            <View className="px-6 py-10 border-b border-gray-100 mt-4">
              <View className="bg-[#1E3A8A] w-14 h-14 rounded-full items-center justify-center mb-4 shadow-sm">
                <Text className="text-white font-bold text-2xl">F</Text>
              </View>
              <Text className="text-[#1E3A8A] font-bold text-xl">FUNDEA</Text>
              <Text className="text-gray-500 text-xs">MICROFINANZAS</Text>
            </View>

            <ScrollView className="flex-1 px-4 py-4" showsVerticalScrollIndicator={false}>
              
              {/* Opción Simple: Inicio */}
              <TouchableOpacity className="flex-row items-center px-4 py-3 mb-2 rounded-xl bg-gray-50" onPress={() => setIsMenuOpen(false)}>
                <View className="mr-4">
                  <Feather name="home" size={20} color="#4B5563" />
                </View>
                <Text className="text-[#1F2937] font-semibold text-base">Inicio</Text>
              </TouchableOpacity>

              {/* Acordeón: Gestiones */}
              <View className="mb-2">
                <TouchableOpacity 
                  className="flex-row items-center justify-between px-4 py-3 rounded-xl bg-gray-50"
                  onPress={() => toggleSection('Gestiones')}
                >
                  <View className="flex-row items-center">
                    <Feather name="clipboard" size={20} color="#4B5563" />
                    <Text className="text-[#1F2937] font-semibold text-base ml-3">Gestiones</Text>
                  </View>
                  <Feather name={expandedSection === 'Gestiones' ? "chevron-up" : "chevron-down"} size={20} color="#9CA3AF" />
                </TouchableOpacity>
                
                {expandedSection === 'Gestiones' && (
                  <View className="pl-12 pr-4 py-2 border-l-2 border-gray-100 ml-6 mt-1">
                    <TouchableOpacity className="py-3">
                      <Text className="text-gray-600 font-medium">SGRAS Línea Base</Text>
                    </TouchableOpacity>
                    <TouchableOpacity className="py-3">
                      <Text className="text-gray-600 font-medium">Línea base Polímeros</Text>
                    </TouchableOpacity>
                    <TouchableOpacity className="py-3">
                      <Text className="text-gray-600 font-medium">Agricultura Inteligente</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Acordeón: Perfil */}
              <View className="mb-6">
                <TouchableOpacity 
                  className="flex-row items-center justify-between px-4 py-3 rounded-xl bg-gray-50"
                  onPress={() => toggleSection('Perfil')}
                >
                  <View className="flex-row items-center">
                    <Feather name="user" size={20} color="#4B5563" />
                    <Text className="text-[#1F2937] font-semibold text-base ml-3">Perfil</Text>
                  </View>
                  <Feather name={expandedSection === 'Perfil' ? "chevron-up" : "chevron-down"} size={20} color="#9CA3AF" />
                </TouchableOpacity>
                
                {expandedSection === 'Perfil' && (
                  <View className="pl-12 pr-4 py-2 border-l-2 border-gray-100 ml-6 mt-1">
                    <TouchableOpacity className="flex-row items-center py-3">
                      <Feather name="user" size={16} color="#4B5563" />
                      <Text className="text-gray-600 font-medium ml-3">Datos del usuario</Text>
                    </TouchableOpacity>
                    <TouchableOpacity className="flex-row items-center py-3">
                      <Feather name="lock" size={16} color="#4B5563" />
                      <Text className="text-gray-600 font-medium ml-3">Cambio de contraseña</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity className="flex-row items-center py-3 mt-2" onPress={executeLogout}>
                      <Feather name="log-out" size={16} color="#EF4444" />
                      <Text className="text-[#EF4444] font-bold ml-3">Cerrar sesión</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
          
          {/* Área clickable transparente para cerrar el menú */}
          <TouchableOpacity className="flex-1" onPress={() => setIsMenuOpen(false)}>
            <View className="absolute top-12 right-6 bg-white/20 p-2 rounded-full">
              <Feather name="x" size={28} color="white" />
            </View>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
};