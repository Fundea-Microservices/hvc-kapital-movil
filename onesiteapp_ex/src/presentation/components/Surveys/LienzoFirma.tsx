import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  PanResponder,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

import {
  agregarPuntoFiltrado,
  esFirmaValida,
  trazoAPath,
  type Trazo,
} from '../../../domain/multimedia/firma';

interface LienzoFirmaProps {
  visible: boolean;
  onCancelar: () => void;
  /** Recibe la URI del PNG generado en caché. El llamador lo copia a durable. */
  onFirmar: (uri: string) => void | Promise<void>;
}

/**
 * Lienzo de firma manuscrita.
 *
 * POR QUÉ SVG + view-shot Y NO UN WEBVIEW
 * Las librerías habituales de firma incrustan un `<canvas>` HTML en un WebView. Eso
 * añade un puente extra, arranca lento en gama baja y —lo importante aquí— se
 * comporta de forma inconsistente bajo la Nueva Arquitectura. Dibujar con
 * `react-native-svg`, que el proyecto ya usa, y exportar con `captureRef` mantiene
 * todo en el árbol nativo.
 *
 * TODA LA GEOMETRÍA VIVE EN `domain/multimedia/firma.ts`
 * Aquí solo queda el gesto y el pintado. La decisión de qué cuenta como firma válida,
 * el suavizado del trazo y el filtrado de puntos están probados sin dispositivo.
 */
export const LienzoFirma = ({ visible, onCancelar, onFirmar }: LienzoFirmaProps) => {
  const [trazos, setTrazos] = useState<Trazo[]>([]);
  const [trazoActual, setTrazoActual] = useState<Trazo>([]);
  const [guardando, setGuardando] = useState(false);

  // La referencia apunta SOLO al área blanca: `captureRef` exporta exactamente lo que
  // envuelve, así que incluir la cabecera o los botones los imprimiría en el PNG.
  const areaFirmaRef = useRef<View>(null);

  /**
   * El trazo en curso se lleva también en una referencia porque `PanResponder` captura
   * el estado del render en el que se creó: leer `trazoActual` dentro de los callbacks
   * devolvería siempre el valor inicial y la firma saldría con un solo punto.
   */
  const trazoActualRef = useRef<Trazo>([]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: evento => {
        const { locationX, locationY } = evento.nativeEvent;
        const inicial: Trazo = [{ x: locationX, y: locationY }];
        trazoActualRef.current = inicial;
        setTrazoActual(inicial);
      },

      onPanResponderMove: evento => {
        const { locationX, locationY } = evento.nativeEvent;
        const actualizado = agregarPuntoFiltrado(trazoActualRef.current, {
          x: locationX,
          y: locationY,
        });
        // Si el punto se descartó por cercanía, no se re-renderiza.
        if (actualizado === trazoActualRef.current) return;
        trazoActualRef.current = actualizado;
        setTrazoActual(actualizado);
      },

      onPanResponderRelease: () => {
        const terminado = trazoActualRef.current;
        if (terminado.length > 0) setTrazos(previos => [...previos, terminado]);
        trazoActualRef.current = [];
        setTrazoActual([]);
      },
    }),
  ).current;

  const limpiar = (): void => {
    setTrazos([]);
    setTrazoActual([]);
    trazoActualRef.current = [];
  };

  const cerrar = (): void => {
    limpiar();
    onCancelar();
  };

  const guardar = async (): Promise<void> => {
    if (!esFirmaValida(trazos)) {
      Alert.alert(
        'Firma incompleta',
        'El trazo es demasiado corto para registrarse como firma. Intente nuevamente.',
      );
      return;
    }

    setGuardando(true);
    try {
      // PNG y no JPG: la firma es un trazo sobre fondo blanco y el JPG introduce
      // artefactos alrededor de las líneas finas que la vuelven sucia al ampliarla
      // en el expediente.
      const uri = await captureRef(areaFirmaRef, { format: 'png', quality: 1 });
      await onFirmar(uri);
      limpiar();
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      console.error(`❌ [Firma] No se pudo exportar el lienzo: ${detalle}`);
      Alert.alert('No se pudo guardar la firma', 'Ocurrió un problema al generar la imagen.');
    } finally {
      setGuardando(false);
    }
  };

  const hayTrazo = trazos.length > 0 || trazoActual.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cerrar}>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-white rounded-t-3xl p-5">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-gray-800 font-bold text-base">Firme en el recuadro</Text>
            <TouchableOpacity onPress={cerrar} className="p-2">
              <Feather name="x" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Área capturable. `collapsable={false}` es obligatorio en Android: sin él,
              el sistema puede fusionar esta vista con su padre por optimización y
              `captureRef` no encuentra nada que exportar. */}
          <View
            ref={areaFirmaRef}
            collapsable={false}
            className="h-56 bg-white border-2 border-dashed border-gray-300 rounded-xl overflow-hidden"
            {...panResponder.panHandlers}
          >
            <Svg width="100%" height="100%">
              {trazos.map((trazo, indice) => (
                <Path
                  key={`trazo-${indice}`}
                  d={trazoAPath(trazo)}
                  stroke="#111827"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ))}
              {trazoActual.length > 0 && (
                <Path
                  d={trazoAPath(trazoActual)}
                  stroke="#111827"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )}
            </Svg>

            {!hayTrazo && (
              // `pointerEvents="none"`: el texto guía no debe robarle el gesto al lienzo.
              <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
                <Feather name="edit-3" size={22} color="#D1D5DB" />
                <Text className="text-gray-300 text-xs mt-1">Dibuje su firma aquí</Text>
              </View>
            )}
          </View>

          <View className="flex-row mt-4">
            <TouchableOpacity
              onPress={limpiar}
              disabled={!hayTrazo || guardando}
              className={`flex-1 p-4 rounded-xl border mr-2 items-center ${
                hayTrazo && !guardando ? 'border-gray-300 bg-white' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <Text className={hayTrazo && !guardando ? 'text-gray-700 font-bold' : 'text-gray-400 font-bold'}>
                Limpiar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => { void guardar(); }}
              disabled={!hayTrazo || guardando}
              className={`flex-1 p-4 rounded-xl ml-2 items-center justify-center ${
                hayTrazo && !guardando ? 'bg-[#1E3A8A]' : 'bg-gray-400'
              }`}
            >
              {guardando ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Text className="text-white font-bold">Aceptar firma</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
