import React from 'react';
import { View, Text, Image } from 'react-native';

interface Props {
  /** Nombre completo del que se derivan las iniciales. */
  nombre: string;
  /** Diámetro del círculo en píxeles. */
  tamano?: number;
  /** Foto del usuario. Aún no existe en el backend; queda listo para cuando la exponga. */
  fotoUrl?: string | null;
}

/**
 * Iniciales a partir del nombre: primera letra del nombre y del apellido.
 * Un nombre de una sola palabra devuelve una sola letra; vacío devuelve '?'.
 */
export const calcularIniciales = (nombre: string): string => {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  const primera = palabras[0][0];
  const segunda = palabras.length > 1 ? palabras[palabras.length - 1][0] : '';
  return `${primera}${segunda}`.toUpperCase();
};

/** Avatar circular del usuario: foto si existe, iniciales mientras no. */
export const AvatarUsuario = ({ nombre, tamano = 64, fotoUrl = null }: Props) => {
  const estiloCirculo = {
    width: tamano,
    height: tamano,
    borderRadius: tamano / 2,
  };

  if (fotoUrl) {
    return (
      <Image
        source={{ uri: fotoUrl }}
        style={estiloCirculo}
        className="border-2 border-brand-orange"
        resizeMode="cover"
      />
    );
  }

  return (
    <View
      style={estiloCirculo}
      className="bg-brand-blue border-2 border-brand-orange items-center justify-center"
    >
      <Text
        className="text-white font-inter-bold"
        style={{ fontSize: tamano * 0.36 }}
        allowFontScaling={false}
      >
        {calcularIniciales(nombre)}
      </Text>
    </View>
  );
};
