import React from 'react';
import * as Lucide from 'lucide-react-native';

/**
 * Ícono del menú lateral, resuelto POR NOMBRE desde el catálogo de Lucide.
 *
 * El BackOffice guarda el nombre en `auth.Menu.icono` ("store", "user-lock"), así que
 * el ícono no se conoce al compilar: hay que buscarlo en tiempo de ejecución. Antes se
 * pintaban con Feather, que no tiene esos nombres, y todos caían al de respaldo.
 *
 * COSTO ACEPTADO: importar el catálogo completo mete todos los íconos de Lucide en el
 * bundle. Es el precio de un menú gobernado por datos; si el APK crece de más, la
 * salida es una lista blanca de los íconos realmente usados, no volver a Feather.
 */
type ComponenteIcono = React.ComponentType<{ size?: number; color?: string }>;

/** "user-lock" → "UserLock"; también acepta "UserLock" y "user lock". */
export const aPascalCase = (nombre: string): string =>
  nombre
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join('');

/**
 * Devuelve el componente del ícono, o `Folder` si el nombre no existe.
 * Se valida que sea una función porque el módulo exporta también utilidades
 * (`createLucideIcon`, `icons`) que coincidirían con un nombre inventado.
 */
export const resolverIconoLucide = (nombre?: string | null): ComponenteIcono => {
  const respaldo = Lucide.Folder as unknown as ComponenteIcono;
  if (!nombre || nombre.trim() === '') return respaldo;

  const catalogo = Lucide as unknown as Record<string, unknown>;
  const encontrado = catalogo[aPascalCase(nombre)];

  return typeof encontrado === 'function' || typeof encontrado === 'object'
    ? (encontrado as ComponenteIcono)
    : respaldo;
};

interface Props {
  nombre?: string | null;
  size?: number;
  color?: string;
}

export const IconoMenu = ({ nombre, size = 18, color }: Props) => {
  const Icono = resolverIconoLucide(nombre);
  return <Icono size={size} color={color} />;
};
