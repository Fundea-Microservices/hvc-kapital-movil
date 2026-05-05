import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface SurveyMatrixCardProps {
  titulo: string;
  cantidadRegistros: number;
  onAbrirMatriz: () => void;
}

/**
 * El componente renderiza la tarjeta de acceso a la matriz en la vista principal (S4.1).
 * Oculta la complejidad mostrando únicamente el estado actual y un botón de acción.
 */
export const SurveyMatrixCard = ({ titulo, cantidadRegistros, onAbrirMatriz }: SurveyMatrixCardProps) => {
  return (
    <View className="mb-4 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center flex-1">
          <Feather name="grid" size={24} color="#1E3A8A" />
          <Text className="text-gray-800 font-bold text-lg ml-3 flex-1">{titulo}</Text>
        </View>
        <View className="bg-blue-50 px-3 py-1 rounded-full">
          <Text className="text-[#1E3A8A] font-bold text-xs">{cantidadRegistros} registrados</Text>
        </View>
      </View>
      
      <Text className="text-gray-500 text-sm mb-4">
        Presione el botón para agregar o visualizar los registros de esta sección.
      </Text>

      <TouchableOpacity 
        className="bg-[#1E3A8A] rounded-xl py-3 flex-row justify-center items-center active:bg-[#162d6b]"
        onPress={onAbrirMatriz}
      >
        <Feather name="plus-circle" size={18} color="white" />
        <Text className="text-white font-bold ml-2 text-base">Ingresar Datos</Text>
      </TouchableOpacity>
    </View>
  );
};