import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';

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

  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const containerClasses = esEditable 
    ? (esObligatorio && !valor ? "border-red-500" : "border-blue-500") 
    : "border-gray-200 bg-gray-100";

  // --- PARSEO SEGURO Y ROBUSTO DE OPCIONES ---
  let listaOpciones: string[] = [];
  if (opciones) {
    try {
      // Intento A: Si viene como JSON string válido '["A", "B"]'
      listaOpciones = JSON.parse(opciones);
    } catch (e) {
      // Intento B (Salvavidas): Si viene como texto plano separado por comas "A, B"
      if (typeof opciones === 'string' && opciones.includes(',')) {
        listaOpciones = opciones.split(',').map(o => o.trim());
      } else if (opciones !== '') {
        // Si es una opción única
        listaOpciones = [opciones.trim()];
      }
    }
  }

  // --- MANEJO DE FECHAS ---
  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate && event.type !== 'dismissed') {
      const formattedDate = selectedDate.toISOString().split('T')[0];
      onChangeText(formattedDate);
      onBlur();
    }
  };

  // --- CAPTURA DE GPS ---
  const handleGetLocation = async () => {
    setIsGpsLoading(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso Denegado', 'La App necesita acceso a la ubicación para esta pregunta.');
        setIsGpsLoading(false);
        return;
      }

      let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onChangeText(`${location.coords.latitude}, ${location.coords.longitude}`);
    } catch (error) {
      Alert.alert('Error GPS', 'Asegúrese de tener el GPS encendido.');
    } finally {
      setIsGpsLoading(false);
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
            placeholder={esEditable ? "Ej: 5000.50" : ""}
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
              <Text className="text-amber-500 text-xs italic">Cargando opciones o catálogo vacío...</Text>
            )}
          </View>
        );

      case 'CHECKBOX':
        const textoCheckbox = opciones || etiqueta || 'Confirmar respuesta';
        const valorTrue = 'SI';
        const valorFalse = 'NO';
        const isChecked = valor === valorTrue;

        return (
          <TouchableOpacity 
            disabled={!esEditable}
            onPress={() => { 
              onChangeText(isChecked ? valorFalse : valorTrue); 
              onBlur(); 
            }}
            className={`flex-row items-center p-4 border-2 rounded-xl bg-white ${containerClasses}`}
          >
            <Feather 
              name={isChecked ? 'check-square' : 'square'} 
              size={24} 
              color={isChecked ? "#1E3A8A" : "#9CA3AF"} 
            />
            <Text className={`ml-3 font-medium flex-1 ${isChecked ? 'text-white' : 'text-gray-600'}`}>
              {textoCheckbox}
            </Text>
          </TouchableOpacity>
        );
          
      case 'TEXTAREA':
        return (
          <TextInput
            className={`border-2 rounded-xl p-4 text-base text-gray-800 bg-white ${containerClasses}`}
            editable={esEditable}
            value={valor}
            onChangeText={onChangeText}
            onBlur={onBlur}
            multiline={true}
            numberOfLines={4}
            textAlignVertical="top"
            placeholder={esEditable ? "Escriba los detalles aquí..." : ""}
          />
        );

      case 'TELEFONO':
        return (
          <TextInput
            className={`border-2 rounded-xl p-4 text-base text-gray-800 bg-white ${containerClasses}`}
            editable={esEditable}
            value={valor}
            onChangeText={onChangeText}
            onBlur={onBlur}
            keyboardType="phone-pad"
            placeholder={esEditable ? "Ej: 5555-4444" : ""}
          />
        );

      case 'SELECT':
        return (
          <View className={`border-2 rounded-xl bg-white overflow-hidden ${containerClasses}`}>
            <Picker
              selectedValue={valor}
              onValueChange={(itemValue) => {
                onChangeText(itemValue);
                onBlur();
              }}
              enabled={esEditable}
              dropdownIconColor="#1E3A8A"
              mode="dropdown"
              // ⚡ CORRECCIÓN DE ESTILO: Fuerza el color de fuente del contenedor
              style={{ color: '#1F2937', backgroundColor: '#ffffff' }} 
            >
              <Picker.Item label="Seleccione una opción..." value="" color="#9CA3AF" />
              {listaOpciones.map((opcion) => (
                <Picker.Item 
                  key={opcion} 
                  label={opcion} 
                  value={opcion} 
                  // ⚡ CORRECCIÓN CRÍTICA: Rompe el bug de texto blanco sobre fondo blanco de Android
                  color="#1F2937" 
                  style={{ backgroundColor: '#ffffff' }}
                />
              ))}
            </Picker>
          </View>
        );

      case 'COORDENADAS':
        return (
          <View className={`flex-row items-center justify-between border-2 rounded-xl p-4 bg-white ${containerClasses}`}>
            <View className="flex-1 mr-3">
              <Text className="text-gray-400 text-xs font-bold mb-1">Coordenadas Actuales</Text>
              <Text className={`text-base font-medium ${valor ? 'text-[#1E3A8A]' : 'text-gray-400 italic'}`}>
                {valor || 'Sin capturar'}
              </Text>
            </View>
            <TouchableOpacity 
              onPress={handleGetLocation} 
              disabled={!esEditable || isGpsLoading} 
              className={`p-3 rounded-full ${esEditable ? 'bg-[#1E3A8A]' : 'bg-gray-300'}`}
            >
              {isGpsLoading ? <ActivityIndicator color="white" /> : <Feather name="map-pin" size={20} color="white" />}
            </TouchableOpacity>
          </View>
        );

      default: //  TEXTO NORMAL AL FINAL
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
      {etiqueta !== 'Pregunta sin etiqueta' && (
        <Text className="text-gray-500 font-bold text-xs tracking-wider mb-2 ml-1">
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