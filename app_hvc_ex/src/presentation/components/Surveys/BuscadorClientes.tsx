import React from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';

/**
 * Campo de búsqueda de la agenda.
 *
 * Es puramente presentacional: recibe y devuelve el texto, sin tocar la base ni saber
 * cómo se filtra. El valor que muestra es el INMEDIATO —para que el cursor no salte
 * mientras se teclea—; posponer el filtrado es responsabilidad de la pantalla.
 */

interface Props {
  valor: string;
  onCambiar: (texto: string) => void;
  marcador?: string;
}

export const BuscadorClientes = ({ valor, onCambiar, marcador }: Props) => (
  <View className="flex-row items-center bg-white border border-gray-200 rounded-2xl px-4 h-12">
    <Feather name="search" size={18} color="#9CA3AF" />
    <TextInput
      value={valor}
      onChangeText={onCambiar}
      placeholder={marcador ?? 'Buscar por DPI, nombre, cuenta u operación...'}
      placeholderTextColor="#9CA3AF"
      // Un documento o una cuenta no llevan mayúscula inicial ni corrección: dejarlas
      // activas hace que el teclado "arregle" el término y la búsqueda no encuentre nada.
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      className="flex-1 ml-2 text-gray-700 text-sm"
    />
    {valor !== '' && (
      <TouchableOpacity
        onPress={() => onCambiar('')}
        // Área de toque holgada: el icono por sí solo es más pequeño que el mínimo
        // cómodo con guantes o al sol, que es como se usa esto en campo.
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityLabel="Limpiar búsqueda"
      >
        <Feather name="x" size={18} color="#6B7280" />
      </TouchableOpacity>
    )}
  </View>
);
