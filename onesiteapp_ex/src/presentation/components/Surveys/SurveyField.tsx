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
  reglaValidacion?: string | null;
  onBlur: () => void;
}

export const SurveyField = ({
  etiqueta, tipoDato, esObligatorio, esEditable, valor, opciones, onChangeText, reglaValidacion, mensajeInfo, onBlur
}: SurveyFieldProps) => {

  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  const insets = useSafeAreaInsets();

  const tipoFormateado = tipoDato ? tipoDato.trim().toUpperCase() : 'TEXTO';
 /** if (listaOpciones.length === 0 && ['SELECT', 'LISTA', 'RADIO', 'MULTISELECT'].includes(tipoFormateado)) {
    listaOpciones = ['SI', 'NO'];
  } */
    //evaluacion regex 
    const evaluarRegexInput = (texto: string): boolean => {
    if (!reglaValidacion || !texto || texto.trim() === '') {
      setErrorValidacion(null);
      return true; 
    }
    try {
      // El sistema genera el compilador de expresiones regulares en tiempo de ejecución
      const regex = new RegExp(reglaValidacion);
      const esValido = regex.test(texto);
      
      if (!esValido) {
        setErrorValidacion("Formato incorrecto");
        return false;
      }
      
      setErrorValidacion(null);
      return true;
    } catch (e) {
      // Failsafe de seguridad: si el admin escribe un Regex corrupto en el BackOffice, 
      // el teléfono no colapsa y permite continuar al asesor.
      console.warn("Regla Regex corrupta detectada en el BackOffice:", reglaValidacion);
      setErrorValidacion(null);
      return true;
    }
  };
  //bordes dinamicos
  const obtenerClaseBordeVisual = () => {
    // REGLA 3: Si NO es editable (EsEditable = 0) -> Borde Gris Mandatorio
    if (!esEditable) {
      return "border-gray-200 bg-gray-50 text-gray-400";
    }

    const regexInvalido = errorValidacion !== null;
    const obligatorioVacio = esObligatorio && (!valor || valor.trim() === '' || valor === '[]');

    // REGLA 1: Borde Rojo -> Obligatorio vacío O Editable que falla la expresión regular
    if (obligatorioVacio || regexInvalido) {
      return "border-red-500 bg-red-50/10";
    }

    // REGLA 2: Borde Azul -> Opcionales limpios O Obligatorios ya llenos y válidos
    return "border-blue-500 bg-white";
  };

  const containerClasses = obtenerClaseBordeVisual();

  //mascaras inteligentes 
  const aplicarMascaraFormato = (texto: string) => {
    let textoProcesado = texto;

    if (tipoFormateado === 'TELEFONO') {
      // Máscara Financiera de Guatemala: 1234-5678
      const numeros = texto.replace(/\D/g, "");
      if (numeros.length <= 4) textoProcesado = numeros;
      else textoProcesado = `${numeros.slice(0, 4)}-${numeros.slice(4, 8)}`;
    } else if (tipoFormateado === 'NUMERO' || tipoFormateado === 'ENTERO') {
      // Filtro estricto numérico directo
      textoProcesado = texto.replace(/[^0-9.]/g, '');
    }

    onChangeText(textoProcesado);
    evaluarRegexInput(textoProcesado); // Validación reactiva inmediata al escribir
  };

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
        Alert.alert('Permiso Denegado', 'La App necesita acceso a la ubicación.');
        setIsGpsLoading(false);
        return;
      }
      let location = await Location.getLastKnownPositionAsync({});
      if (!location) {
        const locationPromise = Location.getCurrentPositionAsync({ 
          accuracy: Location.Accuracy.Lowest 
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("TIEMPO_AGOTADO")), 5000);
        });
        location = await Promise.race([locationPromise, timeoutPromise]) as Location.LocationObject;
      }
if (location && location.coords) {
        const strCoords = `${location.coords.latitude}, ${location.coords.longitude}`;
        onChangeText(strCoords);
      onBlur();
    }
    } catch (error : any) {
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

    switch (tipoFormateado) {
      case 'NUMERO':
      case 'DECIMAL':
      case 'ENTERO':
      case 'EMAIL':
      case 'TELEFONO':
        return (
          <TextInput
            className={`border-2 rounded-xl p-4 text-base text-gray-800 bg-white ${containerClasses}`}
            editable={esEditable}
            value={valor}
            onChangeText={aplicarMascaraFormato}
            onBlur={() => { evaluarRegexInput(valor); onBlur(); }}
            keyboardType={tipoFormateado === 'EMAIL' ? 'email-address' : tipoFormateado === 'TELEFONO' ? 'phone-pad' : 'numeric'}
            autoCapitalize="none"
            placeholder={esEditable ? "Escriba los datos aquí..." : ""}
          />
        );

      case 'FECHA':
      case 'DATE':
        return (
          <View>
            <TouchableOpacity
              disabled={!esEditable}
              onPress={() => setShowDatePicker(true)}
              className={`border-2 p-4 rounded-xl flex-row justify-between items-center ${containerClasses}`}
            >
              <Text className={valor ? 'text-gray-800' : 'text-gray-400'}>
                {valor ? new Date(valor + 'T00:00:00').toLocaleDateString('es-ES') : 'Seleccione una fecha...'}
              </Text>
              <Feather name="calendar" size={18} color="#1E3A8A" />
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={valor ? new Date(valor) : new Date()}
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
                  onPress={() => { aplicarMascaraFormato(opcion); onBlur(); }}
                  className={`px-5 py-3 rounded-full border-2 ${valor === opcion ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}
                >
                  <Text className={`font-bold ${valor === opcion ? 'text-white' : 'text-gray-600'}`}>{opcion}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text className="text-amber-500 text-xs italic">Catálogo no disponible offline.</Text>
            )}
          </View>
        );

      case 'CHECKBOX':
        const isChecked = valor === 'SI';
        return (
          <TouchableOpacity
            disabled={!esEditable}
            onPress={() => { aplicarMascaraFormato(isChecked ? 'NO' : 'SI'); onBlur(); }}
            className={`flex-row items-center p-4 border-2 rounded-xl ${containerClasses}`}
          >
            <Feather name={isChecked ? 'check-square' : 'square'} size={24} color={isChecked ? "#1E3A8A" : "#9CA3AF"} />
            <Text className="ml-3 font-medium flex-1 text-gray-600">{etiqueta || 'Confirmar'}</Text>
          </TouchableOpacity>
        );

      case 'TEXTAREA':
        return (
          <TextInput
            className={`border-2 rounded-xl p-4 text-base text-gray-800 bg-white ${containerClasses}`}
            editable={esEditable}
            value={valor}
            onChangeText={aplicarMascaraFormato}
            onBlur={() => { evaluarRegexInput(valor); onBlur(); }}
            multiline={true}
            numberOfLines={4}
            textAlignVertical="top"
            placeholder={esEditable ? "Escriba los detalles aquí..." : ""}
          />
        );

      case 'LISTA':
      case 'SELECT':
        return (
          <>
            <TouchableOpacity 
              disabled={!esEditable}
              onPress={() => setShowDropdown(true)}
              className={`border-2 rounded-xl p-4 flex-row items-center justify-between ${containerClasses}`}
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
                        onPress={() => { aplicarMascaraFormato(opcion); onBlur(); setShowDropdown(false); }}
                      >
                        <Text className={`text-sm ${valor === opcion ? 'text-[#1E3A8A] font-bold' : 'text-gray-700'}`}>{opcion}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </>
        );

      case 'MULTISELECT':
        let opcionesSeleccionadas: string[] = [];
        if (valor) {
          if (valor.includes('||')) opcionesSeleccionadas = valor.split('||').map(v => v.trim()).filter(Boolean);
          else if (listaOpciones.includes(valor.trim())) opcionesSeleccionadas = [valor.trim()];
          else opcionesSeleccionadas = valor.split(',').map(v => v.trim()).filter(Boolean);
        }

        const toggleOpcionMulti = (opcionRaw: string) => {
          const optLimpia = opcionRaw.trim();
          let nuevaSeleccion = [...opcionesSeleccionadas];
          if (nuevaSeleccion.includes(optLimpia)) nuevaSeleccion = nuevaSeleccion.filter(opt => opt !== optLimpia);
          else nuevaSeleccion.push(optLimpia);
          
          aplicarMascaraFormato(nuevaSeleccion.join('||'));
          onBlur();
        };

        return (
          <View className={`p-2 border-2 rounded-xl ${containerClasses}`}>
            {listaOpciones.length > 0 ? (
              listaOpciones.map((opcionRaw, idx) => {
                const opcionLimpia = opcionRaw.trim();
                const check = opcionesSeleccionadas.includes(opcionLimpia);
                return (
                  <TouchableOpacity
                    key={`multi-${idx}`}
                    disabled={!esEditable}
                    onPress={() => toggleOpcionMulti(opcionRaw)}
                    className={`flex-row items-center py-3 px-3 my-1 rounded-lg border ${check ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'}`}
                  >
                    <Feather name={check ? 'check-square' : 'square'} size={20} color={check ? "#1E3A8A" : "#9CA3AF"} />
                    <Text className={`ml-3 flex-1 ${check ? 'font-bold text-[#1E3A8A]' : 'text-gray-600'}`}>{opcionLimpia}</Text>
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text className="text-amber-500 text-xs italic">Catálogo no disponible offline.</Text>
            )}
          </View>
        );

      case 'COORDENADAS':
      case 'GEOLOCALIZACION':
      case 'UBICACION':
        let iconoRenderizado = isGpsLoading 
          ? <ActivityIndicator size="small" color="white" /> 
          : valor ? <Feather name="check" size={20} color="white" /> : <Feather name="map-pin" size={20} color="white" />;

        return (
          <View className={`p-4 border-2 border-dashed rounded-xl flex-row items-center justify-between ${valor ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50/50 border-blue-200'}`}>
            <View className="flex-1 mr-2">
              <Text className="text-gray-400 text-xs font-bold uppercase tracking-wider">Coordenadas</Text>
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
            onChangeText={aplicarMascaraFormato}
            onBlur={() => { evaluarRegexInput(valor); onBlur(); }}
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

      {/* ERROR DE VALIDACIÓN EN TIEMPO REAL */}
      {errorValidacion && (
        <Text className="text-red-500 text-xs font-bold ml-1 mt-1.5 tracking-wide">
          {errorValidacion}
        </Text>
      )}

      {mensajeInfo && !errorValidacion && (
        <View className="flex-row items-center mt-2 bg-amber-50 p-2 rounded-lg border border-amber-100">
          <Feather name="info" size={14} color="#F59E0B" />
          <Text className="text-[#F59E0B] text-xs ml-2 font-medium flex-1">{mensajeInfo}</Text>
        </View>
      )}
    </View>
  );
};