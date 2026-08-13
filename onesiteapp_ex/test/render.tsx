import React, { type ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

/**
 * `render` con los proveedores que la aplicación monta en su raíz.
 *
 * Sin `SafeAreaProvider`, cualquier componente que use `useSafeAreaInsets` lanza
 * "No safe area value available" — que es un fallo del ENTORNO de prueba, no del
 * componente. Reproducir aquí el árbol de proveedores evita que cada archivo de
 * prueba tenga que recordarlo, y evita también la tentación de simular el hook, que
 * es lo que convertiría la prueba en una verificación del mock.
 *
 * Las medidas son fijas y con valores realistas de un dispositivo con notch: si un
 * componente calcula posiciones a partir de los insets, el resultado es determinista.
 */
const MEDIDAS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const Proveedores = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={MEDIDAS}>{children}</SafeAreaProvider>
);

/** Úsese en lugar del `render` de la librería. */
export const renderConProveedores = (
  ui: ReactElement,
  opciones?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: Proveedores, ...opciones });

export * from '@testing-library/react-native';
