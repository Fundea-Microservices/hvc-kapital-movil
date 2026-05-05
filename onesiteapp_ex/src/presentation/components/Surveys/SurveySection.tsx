import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';

type SectionState = 'vacio' | 'en_progreso' | 'completado';

interface SurveySectionProps {
  titulo: string;
  estado: SectionState;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/**
 * El componente gestiona el Acordeón Inteligente (S2.2) y los Estados Visuales (S2.4).
 */
export const SurveySection = ({ titulo, estado, isExpanded, onToggle, children }: SurveySectionProps) => {

  // El sistema determina el icono y color basado en el estado de llenado
  const getStatusIcon = () => {
    switch (estado) {
      case 'vacio': return <Feather name="circle" size={24} color="#9CA3AF" />; // Gris
      case 'en_progreso': return <Feather name="minus-circle" size={24} color="#F59E0B" />; // Amarillo
      case 'completado': return <Feather name="check-circle" size={24} color="#10B981" />; // Verde
    }
  };

  return (
    <View className="mb-3 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Cabecera del Acordeón */}
      <TouchableOpacity 
        className={`flex-row items-center justify-between p-4 ${isExpanded ? 'bg-blue-50' : 'bg-white'}`}
        onPress={onToggle}
      >
        <View className="flex-row items-center flex-1">
          {getStatusIcon()}
          <Text className="text-gray-800 font-bold text-lg ml-3 flex-1">{titulo}</Text>
        </View>
        <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={24} color="#6B7280" />
      </TouchableOpacity>

      {/* Cuerpo del Acordeón (Renderizado Condicional) */}
      {isExpanded && (
        <View className="p-4 border-t border-gray-100 bg-white">
          {children}
        </View>
      )}
    </View>
  );
};