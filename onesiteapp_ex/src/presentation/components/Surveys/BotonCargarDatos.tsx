import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';

/**
 * Botón de recarga de la cartera de la encuesta abierta.
 *
 * Presentacional: la pantalla decide el estado y qué ocurre al pulsar. Se separan varios
 * estados en vez de un simple "cargando/no cargando" porque el asesor trabaja sin
 * cobertura buena y necesita distinguir "no hay señal" de "el servidor falló" o de
 * "esto no está configurado"; con un único mensaje genérico, los tres se reportan como
 * "no funciona" y no hay forma de saber cuál era.
 */

export type EstadoCarga =
  | 'reposo'
  | 'cargando'
  | 'exito'
  | 'sin_red'
  | 'error'
  | 'sin_configurar'
  | 'ocupado';

interface Props {
  estado: EstadoCarga;
  onPress: () => void;
  /** Texto de resultado; si falta se usa el genérico del estado. */
  mensaje?: string | null;
}

const MENSAJES: Record<EstadoCarga, string> = {
  reposo: 'Cargar datos',
  cargando: 'Cargando clientes…',
  exito: 'Cartera actualizada',
  // El texto dice qué HACER, no solo qué pasó: el control sigue siendo pulsable y sin
  // esa pista parece un cartel informativo, dejando al asesor sin salida aparente.
  sin_red: 'Sin conexión. Toque para reintentar.',
  error: 'No se pudo actualizar. Reintentar',
  sin_configurar: 'Origen de datos no configurado',
  ocupado: 'Sincronización en curso. Inténtelo de nuevo.',
};

const ESTILOS: Record<EstadoCarga, { contenedor: string; texto: string; color: string }> = {
  reposo: { contenedor: 'border-[#1E3A8A] bg-white', texto: 'text-[#1E3A8A]', color: '#1E3A8A' },
  cargando: { contenedor: 'border-gray-200 bg-gray-50', texto: 'text-gray-500', color: '#6B7280' },
  exito: { contenedor: 'border-green-300 bg-green-50', texto: 'text-green-700', color: '#15803D' },
  sin_red: { contenedor: 'border-amber-300 bg-amber-50', texto: 'text-amber-700', color: '#B45309' },
  error: { contenedor: 'border-amber-300 bg-amber-50', texto: 'text-amber-700', color: '#B45309' },
  sin_configurar: { contenedor: 'border-gray-200 bg-gray-50', texto: 'text-gray-400', color: '#9CA3AF' },
  ocupado: { contenedor: 'border-gray-200 bg-gray-50', texto: 'text-gray-500', color: '#6B7280' },
};

const ICONOS: Record<
  EstadoCarga,
  'refresh-cw' | 'check-circle' | 'wifi-off' | 'alert-triangle' | 'slash' | 'clock'
> = {
  reposo: 'refresh-cw',
  cargando: 'refresh-cw',
  exito: 'check-circle',
  sin_red: 'wifi-off',
  error: 'alert-triangle',
  sin_configurar: 'slash',
  ocupado: 'clock',
};

export const BotonCargarDatos = ({ estado, onPress, mensaje }: Props) => {
  // "ocupado" NO se inhabilita: el sync termina solo y el asesor debe poder reintentar
  // sin salir y volver a entrar a la agenda.
  const inhabilitado = estado === 'cargando' || estado === 'sin_configurar';
  const estilo = ESTILOS[estado];
  const texto = mensaje ?? MENSAJES[estado];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inhabilitado}
      className={`flex-row items-center justify-center border rounded-2xl h-11 px-4 ${estilo.contenedor} ${
        inhabilitado ? 'opacity-70' : ''
      }`}
      accessibilityRole="button"
      accessibilityState={{ disabled: inhabilitado }}
    >
      {estado === 'cargando' ? (
        <ActivityIndicator size="small" color={estilo.color} />
      ) : (
        <Feather name={ICONOS[estado]} size={16} color={estilo.color} />
      )}
      <View className="ml-2 flex-shrink">
        <Text className={`font-bold text-sm ${estilo.texto}`} numberOfLines={1}>
          {texto}
        </Text>
      </View>
    </TouchableOpacity>
  );
};
