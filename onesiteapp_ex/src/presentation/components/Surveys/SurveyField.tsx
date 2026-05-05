import React from 'react';
import { View, Text, TextInput } from 'react-native';

interface SurveyFieldProps {
  etiqueta: string;
  esObligatorio: boolean;
  esEditable: boolean; // S3.4: Control de bloqueo 
  valor: string;
  mensajeInfo?: string; // Para mostrar: "Valor calculado automáticamente" [cite: 57]
  onChangeText: (text: string) => void;
  onBlur: () => void; // NUEVO: Disparador del Auto-Save 
}

/**
 * El componente renderiza un input aplicando la identidad visual (S2.3).
 * Bordes: Rojo (Obligatorio), Azul (Opcional), Fondo Gris (Solo lectura).
 */
export const SurveyField = ({ etiqueta, esObligatorio, esEditable, valor, onChangeText, mensajeInfo, onBlur }: SurveyFieldProps) => {
  
  // La lógica determina las clases de NativeWind según las reglas de negocio
  const containerClasses = esEditable 
    ? (esObligatorio ? "border-red-500" : "border-blue-500") 
    : "border-gray-200 bg-gray-100"; // Solo lectura (Gris)

 return (
    <View className="mb-4">
      <Text className="text-gray-700 font-semibold mb-1 text-sm">{etiqueta}</Text>
      <TextInput
        className={`border-2 rounded-xl p-4 text-base text-gray-800 ${containerClasses}`}
        editable={esEditable}
        value={valor}
        onChangeText={onChangeText}
        onBlur={onBlur} // Se ejecuta al salir del campo
        placeholder={esEditable ? "Ingrese un valor" : "No editable"}
      />
      {/* Mensajería UI de apoyo (S3) */}
      {mensajeInfo && (
        <Text className="text-[#F59E0B] text-xs mt-1 font-medium">{mensajeInfo}</Text>
      )}
    </View>
  );
};