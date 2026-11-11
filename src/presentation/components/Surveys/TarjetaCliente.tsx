import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BadgeEstadoGestion } from './BadgeEstadoGestion';
import LocalClientePendiente from '../../../data/local/models/LocalClientePendiente';

/**
 * Tarjeta de un cliente en la agenda, con su acordeón de acciones.
 *
 * Recibe el modelo y callbacks; no consulta ni escribe en la base. Toda la reactividad
 * la aporta el `observeWithColumns` de la pantalla: si aquí se muestra una columna
 * nueva, hay que declararla TAMBIÉN en ese array o la tarjeta se quedará con el valor
 * anterior sin que nada lo delate (una query observada no avisa de cambios de columna).
 */

interface Props {
  cliente: LocalClientePendiente;
  expandido: boolean;
  onAlternar: () => void;
  onContinuar: () => void;
  onCancelar: () => void;
}

/** Une los datos secundarios omitiendo los ausentes, para no dejar separadores huérfanos. */
const lineaDatos = (cliente: LocalClientePendiente): string =>
  [
    cliente.documento ? `DPI/NIT ${cliente.documento}` : null,
    cliente.cuenta ? `Cta ${cliente.cuenta}` : null,
    cliente.operacion ? `Op ${cliente.operacion}` : null,
  ]
    .filter((parte): parte is string => parte !== null)
    .join(' · ');

export const TarjetaCliente = ({
  cliente,
  expandido,
  onAlternar,
  onContinuar,
  onCancelar,
}: Props) => {
  const esAdHoc = cliente.origen !== 'PRECARGA';
  const expediente = cliente.expediente ?? cliente.codigo;
  const datos = lineaDatos(cliente);

  return (
    <View className="bg-white rounded-3xl p-5 mb-3 border border-orange-200 shadow-sm">
      <View className="flex-row justify-between items-start">
        <View className="flex-1 pr-3">
          <Text className="text-gray-400 text-[10px] font-black uppercase tracking-wider">
            {esAdHoc ? 'CREADO EN CAMPO' : `EXPEDIENTE: ${expediente || 'SIN CÓDIGO'}`}
          </Text>
          <Text className="text-gray-800 font-bold text-base mt-0.5">{cliente.nombre}</Text>

          {cliente.ubicacion ? (
            <View className="flex-row items-center mt-1">
              <Feather name="map-pin" size={11} color="#6B7280" />
              <Text className="text-gray-500 text-xs ml-1">{cliente.ubicacion}</Text>
            </View>
          ) : null}

          {datos !== '' ? (
            <Text className="text-gray-400 text-[11px] mt-1">{datos}</Text>
          ) : null}
        </View>

        <View className="items-end">
          <BadgeEstadoGestion
            estadoGestion={cliente.estado_gestion}
            estadoServidor={cliente.estado_servidor}
          />
          <TouchableOpacity
            onPress={onAlternar}
            className={`p-2 rounded-full mt-2 ${expandido ? 'bg-blue-50' : 'bg-gray-50'}`}
            accessibilityLabel={expandido ? 'Contraer acciones' : 'Ver acciones'}
          >
            <Feather name={expandido ? 'chevron-up' : 'chevron-down'} size={20} color="#1E3A8A" />
          </TouchableOpacity>
        </View>
      </View>

      {expandido && (
        <View className="flex-row gap-3 mt-4 pt-4 border-t border-blue-500">
          <TouchableOpacity
            onPress={onCancelar}
            className="flex-1 py-3 bg-[#F59E0B] rounded-xl border border-red-100"
          >
            <Text className="text-center text-white font-bold text-sm">Cancelar Gestión</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onContinuar}
            className="flex-1 py-3 bg-[#1E3A8A] rounded-xl shadow-sm"
          >
            <Text className="text-center text-white font-bold text-sm">Continuar</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};
