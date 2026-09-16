import React from 'react';
import { View, Text } from 'react-native';

/**
 * Distintivo de estado de gestión de una tarjeta de agenda.
 *
 * Los tres estados vienen de `local_cliente_pendiente.estado_gestion`. Se mantiene la
 * paleta del proyecto: ámbar `#F59E0B` para lo pendiente y azul `#1E3A8A` para lo
 * terminado, que es la misma correspondencia que usa el resto de la aplicación.
 */

interface Props {
  estadoGestion: number;
  /** Estado del BackOffice; si retiró la asignación se avisa, sin ocultar la tarjeta. */
  estadoServidor?: string | null;
}

const ETIQUETAS: Record<number, string> = {
  0: 'PENDIENTE',
  1: 'COMPLETADO',
  2: 'CANCELADO',
};

const CLASES: Record<number, string> = {
  0: 'bg-[#F59E0B]',
  1: 'bg-[#1E3A8A]',
  2: 'bg-gray-400',
};

const REVOCADOS = ['ANULADO', 'RECHAZADO'];

export const BadgeEstadoGestion = ({ estadoGestion, estadoServidor }: Props) => {
  const etiqueta = ETIQUETAS[estadoGestion] ?? 'PENDIENTE';
  const clase = CLASES[estadoGestion] ?? CLASES[0];

  // El aviso se muestra aparte del estado local a propósito: que BackOffice retire la
  // asignación no borra el trabajo ya hecho, y el asesor necesita ver ambas cosas.
  const revocado = REVOCADOS.includes((estadoServidor || '').trim().toUpperCase());

  return (
    <View className="items-end">
      <View className={`px-3 py-1 rounded-full ${clase}`}>
        <Text className="text-white text-[10px] font-black tracking-wider">{etiqueta}</Text>
      </View>
      {revocado && (
        <Text className="text-[9px] font-bold text-red-500 mt-1">RETIRADO POR BACKOFFICE</Text>
      )}
    </View>
  );
};
