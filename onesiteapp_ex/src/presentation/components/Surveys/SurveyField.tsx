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
  // --- FUNCIÓN PARA CAPTURAR GPS ---
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
      // Guardamos la latitud y longitud como respuesta
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
        // 1. Parametrización de Texto: 
  const textoCheckbox = opciones || etiqueta || 'Confirmar respuesta';
  
  // Si en el futuro cambian a '1'/'0' o 'true'/'false', solo lo cambias aquí.
  const valorTrue =  'SI';
  const valorFalse = 'NO' ;
  
  // 3. Estado booleano derivado (hace el código más limpio)
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
      {/* Se agrega 'flex-1' para que si el texto de la BD es muy largo, pase a la siguiente línea sin romper la UI */}
      <Text className={`ml-3 font-medium flex-1 ${isChecked ? 'text-[#1E3A8A]' : 'text-gray-600'}`}>
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
            multiline={true} // Esto lo convierte en Textarea
            numberOfLines={4}
            textAlignVertical="top" // Para que el texto inicie arriba en Android
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
            keyboardType="phone-pad" // Despliega el teclado numérico de teléfono
            placeholder={esEditable ? "Ej: 5555-4444" : ""}
          />
        );

      // EQUIVALENTE A <select> y <option>
      case 'SELECT':
        // En una app real de producción, aquí usaríamos una librería como @react-native-picker/picker
        // Por ahora, simularemos un selector con un Modal (como hicimos con la fecha) o lo renderizaremos como botones si son pocos.
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
              mode="dropdown" // "dialog" para modal, "dropdown" para menú
            >
              <Picker.Item label="Seleccione una opción..." value="" color="#9CA3AF" />
              {listaOpciones.map((opcion) => (
                <Picker.Item key={opcion} label={opcion} value={opcion} />
              ))}
            </Picker>
          </View>
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
        // EQUIVALENTE A BOTÓN DE GEOLOCALIZACIÓN
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
    }
  };

  return (
    <View className="w-full">
      {/* Label de la pregunta */}
      {etiqueta !== 'Pregunta sin etiqueta' && (
        <Text className="text-gray-500 font-bold text-xs-base tracking-wider mb-2 ml-1">
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