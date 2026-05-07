import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';

interface SurveyFieldProps {
  etiqueta: string;
  tipoDato: string;
  esObligatorio: boolean;
  esEditable: boolean;
  valor: string;
  opciones?: string;
  mensajeInfo?: string;
  onChangeText: (text: string) => void;
  onBlur: () => void;
}

export const SurveyField = ({ 
  etiqueta, tipoDato, esObligatorio, esEditable, valor, opciones, onChangeText, mensajeInfo, onBlur 
}: SurveyFieldProps) => {

  // Estado para controlar la visibilidad del Calendario
  const [showDatePicker, setShowDatePicker] = useState(false);

  const containerClasses = esEditable 
    ? (esObligatorio && !valor ? "border-red-500" : "border-blue-500") 
    : "border-gray-200 bg-gray-100";

  // --- PARSEO SEGURO DE OPCIONES (Para Radio y Selects) ---
  let listaOpciones: string[] = [];
  if (opciones) {
    try {
      // Intentamos convertir '["Masculino", "Femenino"]' a un arreglo de JS
      listaOpciones = JSON.parse(opciones);
    } catch (e) {
      console.warn(`Error al parsear opciones para la pregunta ${etiqueta}:`, opciones);
    }
  }

  // --- MANEJO DE FECHAS ---
  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios'); // En iOS el modal se queda abierto
    if (selectedDate && event.type !== 'dismissed') {
      // Formateamos a YYYY-MM-DD
      const formattedDate = selectedDate.toISOString().split('T')[0];
      onChangeText(formattedDate);
      onBlur();
    }
  };

  // --- RENDERIZADO POLIMÓRFICO ---
  const renderContent = () => {
    switch (tipoDato.toUpperCase()) {
      case 'NUMERO':
      case 'DECIMAL':
      case 'ENTERO':
        return (
          <TextInput
            className={`border-2 rounded-xl p-4 text-base text-gray-800 bg-white ${containerClasses}`}
            editable={esEditable}
            value={valor}
            onChangeText={onChangeText}
            onBlur={onBlur}
            keyboardType="numeric"
            placeholder={esEditable ? "Ej: 15000" : ""}
          />
        );

      case 'EMAIL':
        return (
          <TextInput
            className={`border-2 rounded-xl p-4 text-base text-gray-800 bg-white ${containerClasses}`}
            editable={esEditable}
            value={valor}
            onChangeText={onChangeText}
            onBlur={onBlur}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholder={esEditable ? "correo@ejemplo.com" : ""}
          />
        );

      case 'FECHA':
        return (
          <>
            <TouchableOpacity 
              onPress={() => esEditable && setShowDatePicker(true)}
              className={`border-2 rounded-xl p-4 flex-row justify-between items-center bg-white ${containerClasses}`}
            >
              <Text className={valor ? "text-gray-800" : "text-gray-400"}>
                {valor || "Toca para seleccionar fecha"}
              </Text>
              <Feather name="calendar" size={20} color={esEditable ? "#1E3A8A" : "#9CA3AF"} />
            </TouchableOpacity>

            {/* Componente Nativo de Calendario */}
            {showDatePicker && (
              <DateTimePicker
                value={valor ? new Date(valor) : new Date()}
                mode="date"
                display="default"
                onChange={handleDateChange}
              />
            )}
          </>
        );

      case 'RADIO':
        return (
          <View className="flex-row flex-wrap gap-3">
            {listaOpciones.length > 0 ? (
              listaOpciones.map((opcion) => (
                <TouchableOpacity
                  key={opcion}
                  disabled={!esEditable}
                  onPress={() => { onChangeText(opcion); onBlur(); }}
                  className={`px-5 py-3 rounded-full border-2 ${
                    valor === opcion 
                      ? 'bg-blue-600 border-blue-600' 
                      : 'bg-white border-gray-300'
                  }`}
                >
                  <Text className={`font-bold ${valor === opcion ? 'text-white' : 'text-gray-600'}`}>
                    {opcion}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text className="text-red-500 text-xs italic">Opciones mal configuradas en BD</Text>
            )}
          </View>
        );

      case 'CHECKBOX':
        return (
          <TouchableOpacity 
            disabled={!esEditable}
            onPress={() => { onChangeText(valor === 'SI' ? 'NO' : 'SI'); onBlur(); }}
            className={`flex-row items-center p-4 border-2 rounded-xl bg-white ${containerClasses}`}
          >
            <Feather 
              name={valor === 'SI' ? 'check-square' : 'square'} 
              size={24} 
              color={valor === 'SI' ? "#1E3A8A" : "#9CA3AF"} 
            />
            <Text className={`ml-3 font-medium ${valor === 'SI' ? 'text-[#1E3A8A]' : 'text-gray-600'}`}>
              Confirmar respuesta
            </Text>
          </TouchableOpacity>
        );

      default: // TEXTO normal
        return (
          <TextInput
            className={`border-2 rounded-xl p-4 text-base text-gray-800 bg-white ${containerClasses}`}
            editable={esEditable}
            value={valor}
            onChangeText={onChangeText}
            onBlur={onBlur}
            placeholder={esEditable ? "Escriba aquí..." : ""}
          />
        );
    }
  };

  return (
    <View className="w-full">
      {/* Label de la pregunta */}
      {etiqueta !== 'Pregunta sin etiqueta' && (
        <Text className="text-gray-500 font-bold text-xs uppercase tracking-wider mb-2 ml-1">
          {etiqueta}
        </Text>
      )}
      
      {renderContent()}

      {mensajeInfo && (
        <View className="flex-row items-center mt-2 bg-amber-50 p-2 rounded-lg border border-amber-100">
          <Feather name="info" size={14} color="#F59E0B" />
          <Text className="text-[#F59E0B] text-xs ml-2 font-medium flex-1">{mensajeInfo}</Text>
        </View>
      )}
    </View>
  );
};