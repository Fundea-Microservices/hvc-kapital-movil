import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, Alert, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const [showDropdown, setShowDropdown] = useState(false);

  const insets = useSafeAreaInsets();

  const containerClasses = esEditable
    ? (esObligatorio && !valor ? "border-red-500" : "border-blue-500")
    : "border-gray-200 bg-gray-100";

  // --- PARSEO SEGURO Y ROBUSTO DE OPCIONES ---
  let listaOpciones: string[] = [];
  if (opciones) {
    try {
      // 1. Intenta parsear como JSON válido ["Opción 1", "Opción 2"]
      listaOpciones = JSON.parse(opciones);
    } catch (e) {
      // 2. Si no es JSON, divide por comas (solo para catálogos simples, no aplicable al estado guardado)
      if (typeof opciones === 'string' && opciones.includes(',')) {
        listaOpciones = opciones.split(',').map(o => o.trim());
      } else if (opciones !== '') {
        listaOpciones = [opciones.trim()];
      }
    }
  }

  const tipoFormateado = tipoDato ? tipoDato.trim().toUpperCase() : 'TEXTO';
  if (listaOpciones.length === 0 && ['SELECT', 'LISTA', 'RADIO', 'MULTISELECT'].includes(tipoFormateado)) {
    listaOpciones = ['SI', 'NO'];
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
    console.log('[GPS] 1. Botón presionado. Activando isGpsLoading = true');
    setIsGpsLoading(true);
    try {
      console.log(' [GPS] 2. Solicitando permisos a Expo/Android...');
      let { status } = await Location.requestForegroundPermissionsAsync();
      console.log(` [GPS] 3. Estado del permiso devuelto por el sistema: "${status}"`);
      if (status !== 'granted') {
        console.log('❌ [GPS] Bloqueo: El usuario o el dispositivo denegó el permiso.');
        Alert.alert('Permiso Denegado', 'La App necesita acceso a la ubicación.');
        setIsGpsLoading(false);
        return;
      }
      console.log(' [GPS] 4. Permisos OK. Buscando última ubicación conocida en caché...');
      let location = await Location.getLastKnownPositionAsync({});
      console.log(` [GPS] 5. Resultado del caché:`, location ? '¡Encontrada!' : 'Vacía/Null');
      if (!location) {
        console.log(' [GPS] 6. Forzando lectura directa al satélite con timeout de 5s...');
        const locationPromise = Location.getCurrentPositionAsync({ 
          accuracy: Location.Accuracy.Lowest 
        });
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("TIEMPO_AGOTADO")), 5000);
        });

        location = await Promise.race([locationPromise, timeoutPromise]) as Location.LocationObject;
        console.log(' [GPS] 7. Resultado de la carrera de promesas:', location);
      }
if (location && location.coords) {
        const strCoords = `${location.coords.latitude}, ${location.coords.longitude}`;
        console.log(` [GPS] 8. ¡ÉXITO! Guardando coordenadas: ${strCoords}`);
        onChangeText(strCoords);
      onBlur();
    } else {
      console.log('❌ [GPS] Error raro: Location existe pero no tiene coords.', location);
        throw new Error("El objeto location vino vacío.");
      }
    } catch (error : any) {
      console.log("Error GPS:", error);
      console.error("❌ [GPS ERROR CRÍTICO]:", error.message || error);
      Alert.alert(
        'Aviso de Ubicación',
        'No se pudo obtener el GPS a tiempo. Se inyectarán coordenadas de prueba para continuar la gestión.',
        [
          { 
            text: 'Aceptar', 
            onPress: () => {
              console.log(' [GPS] 9. Inyectando coordenadas Fallback (Guatemala).')
              onChangeText("14.6349, -90.5069"); 
              onBlur();
            } 
          }
        ]
      );
    } finally {
      console.log(' [GPS] 10. Apagando spinner. isGpsLoading = false\n');
      setIsGpsLoading(false);
    }
  };

  // --- RENDERIZADO POLIMÓRFICO ---
  const renderContent = () => {
    const tipoLimpio = tipoDato ? tipoDato.trim().toUpperCase() : 'TEXTO';
    //console.log(` [CONTRATO BD] Campo: "${etiqueta}" -> Tipo detectado: "${tipoLimpio}"`);

    switch (tipoLimpio) {
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
      case 'DATE':
        const fechaActual = valor ? new Date(valor) : new Date();
        return (
          <View>
            <TouchableOpacity
              disabled={!esEditable}
              onPress={() => setShowDatePicker(true)}
              className={`border-2 p-4 rounded-xl bg-white flex-row justify-between items-center ${containerClasses}`}
            >
              <Text className={valor ? 'text-gray-800' : 'text-gray-400'}>
                {valor ? new Date(valor + 'T00:00:00').toLocaleDateString('es-ES') : 'Seleccione una fecha...'}
              </Text>
              <Feather name="calendar" size={18} color="#1E3A8A" />
            </TouchableOpacity>

            {showDatePicker && (
              <DateTimePicker
                value={fechaActual}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleDateChange}
              />
            )}
          </View>
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
                  className={`px-5 py-3 rounded-full border-2 ${valor === opcion
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
              <Text className="text-amber-500 text-xs italic">Catálogo vacío o no enlazado.</Text>
            )}
          </View>
        );

      case 'CHECKBOX':
        const textoCheckbox = opciones || etiqueta || 'Confirmar respuesta';
        const isChecked = valor === 'SI';

        return (
          <TouchableOpacity
            disabled={!esEditable}
            onPress={() => {
              onChangeText(isChecked ? 'NO' : 'SI');
              onBlur();
            }}
            className={`flex-row items-center p-4 border-2 rounded-xl bg-white ${containerClasses}`}
          >
            <Feather
              name={isChecked ? 'check-square' : 'square'}
              size={24}
              color={isChecked ? "#1E3A8A" : "#9CA3AF"}
            />
            <Text className="ml-3 font-medium flex-1 text-gray-600">
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

      case 'LISTA':
      case 'SELECT':
        return (
          <>
            <TouchableOpacity 
              disabled={!esEditable}
              onPress={() => setShowDropdown(true)}
              className={`border-2 rounded-xl bg-white p-4 flex-row items-center justify-between ${containerClasses}`}
            >
              <Text className={`flex-1 ${valor ? 'text-gray-800' : 'text-gray-400'}`} numberOfLines={2}>
                {valor || 'Seleccione una opción...'}
              </Text>
              <Feather name="chevron-down" size={20} color="#1E3A8A" />
            </TouchableOpacity>

            <Modal visible={showDropdown} transparent animationType="fade">
              <View className="flex-1 bg-black/60 items-center justify-center px-6">
                <View className="bg-white rounded-[32px] p-6 w-full max-h-[80%] shadow-2xl">
                  <View className="flex-row justify-between items-center mb-4 border-b border-gray-100 pb-4">
                    <Text className="text-[#1E3A8A] font-bold text-lg flex-1">Seleccione una opción</Text>
                    <TouchableOpacity onPress={() => setShowDropdown(false)} className="bg-gray-100 p-2 rounded-full ml-3">
                      <Feather name="x" size={20} color="#4B5563" />
                    </TouchableOpacity>
                  </View>
                  <ScrollView showsVerticalScrollIndicator={true} bounces={false}>
                    {listaOpciones.map((opcion, index) => (
                      <TouchableOpacity
                        key={`${opcion}-${index}`}
                        className={`p-4 rounded-xl mb-2 ${valor === opcion ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-100'}`}
                        onPress={() => {
                          onChangeText(opcion);
                          onBlur();
                          setShowDropdown(false);
                        }}
                      >
                        <Text className={`text-sm ${valor === opcion ? 'text-[#1E3A8A] font-bold' : 'text-gray-700'}`}>
                          {opcion}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </>
        );

      case 'MULTISELECT':
        // Leemos el string guardado de forma segura, evitando romper opciones que tienen comas usando un separador fuerte (|)
        // Para compatibilidad hacia atrás, si el valor contiene "||", lo separamos por "||". Si no, asumimos que está separado por comas (comportamiento antiguo)
        const separador = valor && valor.includes('||') ? '||' : ',';
        const opcionesSeleccionadas = valor ? valor.split(separador).map(v => v.trim()).filter(v => v.length > 0) : [];

        const toggleOpcionMulti = (opcionRaw: string) => {
          const optLimpia = opcionRaw.trim();
          let nuevaSeleccion = [...opcionesSeleccionadas];
          
          if (nuevaSeleccion.includes(optLimpia)) {
            // Quitar opción
            nuevaSeleccion = nuevaSeleccion.filter(opt => opt !== optLimpia);
          } else {
            // Añadir opción
            nuevaSeleccion.push(optLimpia);
          }
          
          // Guardamos utilizando un separador fuerte "||" para que las comas internas de las opciones no se confundan
          onChangeText(nuevaSeleccion.join('||'));
          onBlur();
        };

        return (
          <View className={`p-2 border-2 rounded-xl bg-white ${containerClasses}`}>
            {listaOpciones.length > 0 ? (
              listaOpciones.map((opcionRaw, idx) => {
                const opcionLimpia = opcionRaw.trim();
                const check = opcionesSeleccionadas.includes(opcionLimpia);
                
                return (
                  <TouchableOpacity
                    key={`multi-${idx}`}
                    disabled={!esEditable}
                    onPress={() => toggleOpcionMulti(opcionRaw)}
                    className={`flex-row items-center py-3 px-3 my-1 rounded-lg border ${
                      check ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'
                    } active:bg-gray-200`}
                  >
                    <Feather 
                      name={check ? 'check-square' : 'square'} 
                      size={20} 
                      color={check ? "#1E3A8A" : "#9CA3AF"} 
                    />
                    <Text className={`ml-3 flex-1 ${check ? 'font-bold text-[#1E3A8A]' : 'text-gray-600'}`}>
                      {opcionLimpia}
                    </Text>
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text className="text-amber-500 text-xs italic">Catálogo vacío o no encontrado.</Text>
            )}
          </View>
        );

      case 'COORDENADAS':
      case 'GEOLOCALIZACION':
      case 'UBICACION':
        console.log(` [UI RENDER GPS] Dibujando caja. Valor actual: "${valor}", isGpsLoading: ${isGpsLoading}`);
        // Lógica de renderizado del icono GPS simplificada y segura
        let iconoRenderizado = <Feather name="map-pin" size={20} color="white" />;
        
        if (isGpsLoading) {
          console.log(' [UI RENDER GPS] -> Decidió pintar Spinner');
            iconoRenderizado = <ActivityIndicator size="small" color="white" />;
        } else if (valor) {
          console.log(' [UI RENDER GPS] -> Decidió pintar Check (Completado)');
            iconoRenderizado = <Feather name="check" size={20} color="white" />;
        }else{
          console.log(' [UI RENDER GPS] -> Decidió pintar Map-Pin (Vacío)');
        }

        return (
          <View className={`p-4 border-2 border-dashed rounded-xl flex-row items-center justify-between ${
            valor ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50/50 border-blue-200'
          }`}>
            <View className="flex-1 mr-2">
              <Text className="text-gray-400 text-xs font-bold uppercase tracking-wider">Coordenadas Actuales</Text>
              <Text className="text-gray-700 font-medium mt-0.5">{valor || 'Sin capturar'}</Text>
            </View>
            <TouchableOpacity 
              disabled={!esEditable || isGpsLoading}
              onPress={handleGetLocation}
              className={`p-3 rounded-full shadow-sm ${(!esEditable || isGpsLoading) ? 'bg-gray-400' : 'bg-[#1E3A8A]'}`}
            >
              {iconoRenderizado}
            </TouchableOpacity>
          </View>
        );

      default:
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
        <Text className="text-gray-500 font-bold text-sm tracking-wider mb-2 ml-1">
          {etiqueta} {esObligatorio && <Text className="text-red-500">*</Text>}
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
