import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform, Alert, ActivityIndicator, Modal, ScrollView, Image, Keyboard } from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { obtenerParametroNumerico } from '../../../data/local/services/parametros.service';
import { parsearReglaValidacion, validarValor, aplicarMascara, type ReglaParseada } from '../../../domain/validacion/reglaValidacion';

type NodoOpcion = { valor: string; hijos: NodoOpcion[] };

const REGLA_VACIA: ReglaParseada = { mascara: null, patrones: [], rangos: [] };

interface SurveyFieldProps {
  etiqueta: string;
  tipoDato: string;
  esObligatorio: boolean;
  esEditable: boolean;
  valor: string;
  opciones?: string;
  arbolOpciones?: string;
  mensajeInfo?: string;
  onChangeText: (text: string) => void;
  reglaValidacion?: string | null;
  onBlur: () => void;
}

export const SurveyField = ({
  etiqueta, tipoDato, esObligatorio, esEditable, valor, opciones, arbolOpciones, onChangeText, reglaValidacion, mensajeInfo, onBlur
}: SurveyFieldProps) => {

  const [isGpsLoading, setIsGpsLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [reglaParseada, setReglaParseada] = useState<ReglaParseada>(REGLA_VACIA);
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);
  // Drill-down jerárquico del SELECT: pila de niveles navegados + breadcrumb.
  const [pilaNiveles, setPilaNiveles] = useState<NodoOpcion[][]>([]);
  const [rutaDrill, setRutaDrill] = useState<string[]>([]);

  const insets = useSafeAreaInsets();
  // Alias documentados en el diseño (appEx_Pregunta.TipoDato) → componente equivalente.
  const ALIAS_TIPOS: Record<string, string> = {
    'CATALOGO_UNICA': 'SELECT',
    'CATALOGO_MULTIPLE': 'MULTISELECT',
  };
  const tipoCrudo = tipoDato ? tipoDato.trim().toUpperCase() : 'TEXTO';
  const tipoFormateado = ALIAS_TIPOS[tipoCrudo] || tipoCrudo;

  // DE REGLAS DEL BACKOFFICE — parseo delegado al módulo compartido con
  // DynamicSurveyScreen (mismo criterio para el input en vivo y al finalizar).
  useEffect(() => {
    setReglaParseada(parsearReglaValidacion(reglaValidacion));
  }, [reglaValidacion]);

  // VALIDACIÓN INMUNIZADO CONTRA FALSOS POSITIVOS
  const ejecutarValidacionInstitucional = (textoVisual: string): boolean => {
    const resultado = validarValor(textoVisual, reglaParseada);
    setErrorValidacion(resultado.mensaje);
    return resultado.valido;
  };

  // Se ejecuta la validación reactiva si los datos lógicos cambian desde el servidor
  useEffect(() => {
    if (valor) {
      ejecutarValidacionInstitucional(valor);
    }
  }, [valor, reglaParseada]);

  // Manejador centralizado para la captura y formateo de texto en tiempo real
  const handleInputChange = (textoDirecto: string) => {
    const textoFormateado = reglaParseada.mascara
      ? aplicarMascara(textoDirecto, reglaParseada.mascara)
      : textoDirecto;

    onChangeText(textoFormateado);
    ejecutarValidacionInstitucional(textoFormateado);
  };

  // CÁLCULO DE BORDES ADAPTATIVOS

  const calcularClaseBorde = (): string => {
    // REGLA 3: Campo deshabilitado -> Borde Gris Corporativo
    if (!esEditable) {
      return "border-gray-200 bg-gray-50 text-gray-400";
    }

    const tieneError = errorValidacion !== null;
    const esObligatorioVacio = esObligatorio && (!valor || valor.trim() === '');

    // REGLA 1: Borde Rojo -> Omisión de campo mandatorio o violación de patrón Regex
    if (esObligatorioVacio || tieneError) {
      return "border-red-500 bg-red-50/10 text-red-900";
    }

    // REGLA 2: Borde Azul -> Estado óptimo de recolección de datos
    return "border-blue-500 bg-white text-gray-800";
  };

  const containerClasses = calcularClaseBorde();

  // --- PARSEO SEGURO Y ROBUSTO DE OPCIONES ---
  let listaOpciones: string[] = [];
  if (opciones) {
    try {
      listaOpciones = JSON.parse(opciones);
    } catch (e) {
      if (typeof opciones === 'string' && opciones.includes(',')) {
        listaOpciones = opciones.split(',').map(o => o.trim());
      } else if (opciones !== '') {
        listaOpciones = [opciones.trim()];
      }
    }
  }

  // --- MANEJO DE FECHAS ---
  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    Keyboard.dismiss();
    setShowDatePicker(Platform.OS === 'ios');
    if (selectedDate && event.type !== 'dismissed') {
      const formattedDate = selectedDate.toISOString().split('T')[0];
      handleInputChange(formattedDate);
      onBlur();
    }
  };

  // --- CAPTURA DE GPS ---
  const handleGetLocation = async () => {
    Keyboard.dismiss();
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
        // Timeout parametrizable desde el BackOffice (Cat_Parametros_AppEx) sin nueva versión.
        const gpsTimeoutMs = await obtenerParametroNumerico('GPS_TIMEOUT_MS', 5000);
        const locationPromise = Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Lowest
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("TIEMPO_AGOTADO")), gpsTimeoutMs);
        });
        location = await Promise.race([locationPromise, timeoutPromise]) as Location.LocationObject;
      }
      if (location && location.coords) {
        const strCoords = `${location.coords.latitude}, ${location.coords.longitude}`;
        handleInputChange(strCoords);
        onBlur();
      }
    } catch (error: unknown) {
      Alert.alert(
        'Aviso de Ubicación',
        'No se pudo obtener el GPS a tiempo. Se inyectarán coordenadas de prueba para continuar la gestión.',
        [
          {
            text: 'Aceptar',
            onPress: () => {
              handleInputChange("14.6349, -90.5069");
              onBlur();
            }
          }
        ]
      );
    } finally {
      setIsGpsLoading(false);
    }
  };

  const renderContent = () => {
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
            onChangeText={handleInputChange}
            onBlur={() => { ejecutarValidacionInstitucional(valor); onBlur(); }}
            keyboardType={tipoFormateado === 'EMAIL' ? 'email-address' : reglaParseada.mascara || ['NUMERO', 'TELEFONO', 'ENTERO'].includes(tipoFormateado) ? 'phone-pad' : 'numeric'}
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
              onPress={() => { Keyboard.dismiss(); setShowDatePicker(true); }}
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
                  onPress={() => { Keyboard.dismiss(); handleInputChange(opcion); onBlur(); }} // ⚡ CORREGIDO: Uso de la función unificada
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
            onPress={() => { Keyboard.dismiss(); handleInputChange(isChecked ? 'NO' : 'SI'); onBlur(); }}
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
            onChangeText={handleInputChange}
            onBlur={() => { ejecutarValidacionInstitucional(valor); onBlur(); }}
            multiline={true}
            numberOfLines={4}
            textAlignVertical="top"
            placeholder={esEditable ? "Escriba los detalles aquí..." : ""}
          />
        );

      case 'LISTA':
      case 'SELECT': {
        // Árbol jerárquico (drill-down). Si no llega, se deriva uno plano de listaOpciones
        // para conservar el comportamiento de RADIO-like/fallback.
        let arbol: NodoOpcion[] = [];
        if (arbolOpciones) {
          try { arbol = JSON.parse(arbolOpciones); } catch { arbol = []; }
        }
        if (arbol.length === 0 && listaOpciones.length > 0) {
          arbol = listaOpciones.map(o => ({ valor: o, hijos: [] }));
        }

        const sinOpciones = arbol.length === 0;
        const nivelActual = pilaNiveles.length > 0 ? pilaNiveles[pilaNiveles.length - 1] : arbol;

        const abrirDropdown = () => {
          if (sinOpciones) return;
          Keyboard.dismiss();
          setPilaNiveles([arbol]);
          setRutaDrill([]);
          setTimeout(() => setShowDropdown(true), 50);
        };

        const retrocederNivel = () => {
          if (pilaNiveles.length > 1) {
            setPilaNiveles(prev => prev.slice(0, -1));
            setRutaDrill(prev => prev.slice(0, -1));
          } else {
            setShowDropdown(false);
          }
        };

        const seleccionarNodo = (nodo: NodoOpcion) => {
          Keyboard.dismiss();
          if (nodo.hijos && nodo.hijos.length > 0) {
            // Navega hacia el sub-nivel (no selecciona todavía).
            setPilaNiveles(prev => [...prev, nodo.hijos]);
            setRutaDrill(prev => [...prev, nodo.valor]);
          } else {
            handleInputChange(nodo.valor);
            onBlur();
            setShowDropdown(false);
          }
        };

        return (
          <>
            <TouchableOpacity
              disabled={!esEditable || sinOpciones}
              onPress={abrirDropdown}
              className={`border-2 rounded-xl p-4 flex-row items-center justify-between ${containerClasses}`}
            >
              {sinOpciones ? (
                <Text className="flex-1 text-amber-500 text-xs italic">Catálogo no disponible offline.</Text>
              ) : (
                <Text className={`flex-1 ${valor ? 'text-gray-800' : 'text-gray-400'}`} numberOfLines={2}>
                  {valor || 'Seleccione una opción...'}
                </Text>
              )}
              <Feather name="chevron-down" size={20} color={sinOpciones ? "#9CA3AF" : "#1E3A8A"} />
            </TouchableOpacity>

            <Modal visible={showDropdown} transparent animationType="fade">
              <View className="flex-1 bg-black/60 items-center justify-center px-6">
                <View className="bg-white rounded-[32px] p-6 w-full max-h-[80%] shadow-2xl">
                  <View className="flex-row justify-between items-center mb-4 border-b border-gray-100 pb-4">
                    {pilaNiveles.length > 1 && (
                      <TouchableOpacity onPress={retrocederNivel} className="bg-gray-100 p-2 rounded-full mr-3">
                        <Feather name="chevron-left" size={20} color="#1E3A8A" />
                      </TouchableOpacity>
                    )}
                    <Text className="text-[#1E3A8A] font-bold text-lg flex-1" numberOfLines={1}>
                      {rutaDrill.length > 0 ? rutaDrill[rutaDrill.length - 1] : 'Seleccione una opción'}
                    </Text>
                    <TouchableOpacity onPress={() => setShowDropdown(false)} className="bg-gray-100 p-2 rounded-full ml-3">
                      <Feather name="x" size={20} color="#4B5563" />
                    </TouchableOpacity>
                  </View>

                  {rutaDrill.length > 0 && (
                    <Text className="text-gray-400 text-[11px] mb-3 -mt-1" numberOfLines={1}>{rutaDrill.join('  ›  ')}</Text>
                  )}

                  <ScrollView showsVerticalScrollIndicator={true} bounces={false}>
                    {nivelActual.map((nodo, index) => {
                      const tieneHijos = !!(nodo.hijos && nodo.hijos.length > 0);
                      const seleccionado = valor === nodo.valor;
                      return (
                        <TouchableOpacity
                          key={`${nodo.valor}-${index}`}
                          className={`p-4 rounded-xl mb-2 flex-row items-center justify-between ${seleccionado ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-100'}`}
                          onPress={() => seleccionarNodo(nodo)}
                        >
                          <Text className={`text-sm flex-1 ${seleccionado ? 'text-[#1E3A8A] font-bold' : 'text-gray-700'}`}>{nodo.valor}</Text>
                          {tieneHijos && <Feather name="chevron-right" size={18} color="#9CA3AF" />}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            </Modal>
          </>
        );
      }

      case 'MULTISELECT':
        let opcionesSeleccionadas: string[] = [];
        if (valor) {
          if (valor.includes('||')) opcionesSeleccionadas = valor.split('||').map(v => v.trim()).filter(Boolean);
          else if (listaOpciones.includes(valor.trim())) opcionesSeleccionadas = [valor.trim()];
          else opcionesSeleccionadas = valor.split(',').map(v => v.trim()).filter(Boolean);
        }

        const toggleOpcionMulti = (opcionRaw: string) => {
          Keyboard.dismiss();
          const optLimpia = opcionRaw.trim();
          let nuevaSeleccion = [...opcionesSeleccionadas];
          if (nuevaSeleccion.includes(optLimpia)) nuevaSeleccion = nuevaSeleccion.filter(opt => opt !== optLimpia);
          else nuevaSeleccion.push(optLimpia);

          handleInputChange(nuevaSeleccion.join('||')); // ⚡ CORREGIDO: Uso de la función unificada
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
                    className={`flex-row items-center py-3 px-3 my-1 rounded-lg border ${check ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border border-gray-100'}`}
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

      case 'FOTO':
      case 'DOCUMENTO':
      case 'IMAGEN':
      case 'FIRMA':
        // Tipos multimedia documentados pero aún sin soporte (Storage-Service pendiente).
        // Un TextInput aquí confundiría al encuestador; se muestra un aviso claro.
        return (
          <View className="p-4 border-2 border-dashed border-amber-200 bg-amber-50/50 rounded-xl flex-row items-center">
            <Feather name="camera-off" size={18} color="#F59E0B" />
            <Text className="text-amber-600 text-xs font-medium ml-3 flex-1">
              Captura multimedia no disponible en esta versión de la aplicación.
            </Text>
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
            onChangeText={handleInputChange}
            onBlur={() => { ejecutarValidacionInstitucional(valor); onBlur(); }}
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

      {errorValidacion && (
        <Text className="text-red-500 text-xs font-bold ml-1 mt-1.5 tracking-wide animate-pulse">
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