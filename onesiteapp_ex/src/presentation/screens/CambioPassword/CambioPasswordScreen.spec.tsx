import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  renderConProveedores as render,
  screen,
  fireEvent,
  waitFor,
} from '../../../../test/render';

import { CambioPasswordScreen } from './CambioPasswordScreen';
import { cambiarPasswordApi } from '../../../data/remote/auth.api';

/**
 * Lo que ve —y hace— el usuario en el cambio obligatorio de primer ingreso.
 *
 * El punto crítico no es el estilo, sino la BARRERA: el botón no debe habilitarse
 * hasta que la contraseña cumple la política, y un rechazo del servidor (contraseña
 * actual incorrecta) debe explicarse, no tragarse. La lógica regla-por-regla ya está
 * cubierta en `politicaPassword.spec.ts`; aquí se verifica que la pantalla la respeta.
 */

// El store persiste con AsyncStorage, cuyo módulo nativo no existe en Jest. Se usa el
// mock oficial de la librería para que importar `useAuthStore` no reviente la suite.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// El servicio de red se simula: aquí se prueba la PANTALLA, no el backend.
jest.mock('../../../data/remote/auth.api', () => ({
  cambiarPasswordApi: jest.fn(),
}));

// SecureStore solo se toca en el camino de éxito (borra la bandera). No es objeto de
// esta prueba, así que se neutraliza.
jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(async () => undefined),
}));

const mockCambiar = cambiarPasswordApi as jest.MockedFunction<typeof cambiarPasswordApi>;

const renderPantalla = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CambioPasswordScreen />
    </QueryClientProvider>
  );
};

// Rellena los tres campos con una combinación que cumple las siete reglas.
const llenarValido = () => {
  fireEvent.changeText(screen.getByPlaceholderText('Ingrese su contraseña temporal'), 'Temporal1!');
  fireEvent.changeText(screen.getByPlaceholderText('Ingrese su nueva contraseña'), 'Segura2026#');
  fireEvent.changeText(screen.getByPlaceholderText('Repita su nueva contraseña'), 'Segura2026#');
};

describe('CambioPasswordScreen — reglas visibles', () => {
  it('muestra el checklist de las siete reglas', () => {
    renderPantalla();
    expect(screen.getByText('Entre 8 y 20 caracteres')).toBeTruthy();
    expect(screen.getByText('Un carácter especial (@#$%*!?&)')).toBeTruthy();
    expect(screen.getByText('Distinta a la actual')).toBeTruthy();
  });
});

describe('CambioPasswordScreen — el botón como barrera', () => {
  it('no envía nada cuando la contraseña no cumple la política', () => {
    renderPantalla();
    // Solo se llena la actual: la nueva queda vacía, la política falla y el botón está
    // deshabilitado, así que pulsarlo no debe disparar la petición.
    fireEvent.changeText(screen.getByPlaceholderText('Ingrese su contraseña temporal'), 'Temporal1!');
    fireEvent.press(screen.getByText('Guardar contraseña'));
    expect(mockCambiar).not.toHaveBeenCalled();
  });

  it('envía la petición cuando la contraseña cumple todas las reglas', async () => {
    mockCambiar.mockResolvedValueOnce({ message: 'Contraseña actualizada correctamente' });
    renderPantalla();
    llenarValido();
    fireEvent.press(screen.getByText('Guardar contraseña'));

    await waitFor(() => expect(mockCambiar).toHaveBeenCalledTimes(1));
    expect(mockCambiar).toHaveBeenCalledWith(
      { passwordActual: 'Temporal1!', passwordNueva: 'Segura2026#', confirmarPassword: 'Segura2026#' },
      expect.anything()
    );
  });
});

describe('CambioPasswordScreen — error del servidor', () => {
  it('muestra el mensaje cuando la contraseña actual es incorrecta (401)', async () => {
    // Forma de un error de axios: mensajeDeError lee response.data.message.
    mockCambiar.mockRejectedValueOnce({
      response: { data: { message: 'La contraseña actual no es correcta' } },
    });
    renderPantalla();
    llenarValido();
    fireEvent.press(screen.getByText('Guardar contraseña'));

    await waitFor(() =>
      expect(screen.getByText('La contraseña actual no es correcta')).toBeTruthy()
    );
  });
});

describe('CambioPasswordScreen — éxito', () => {
  it('muestra la confirmación tras un cambio exitoso', async () => {
    mockCambiar.mockResolvedValueOnce({ message: 'Contraseña actualizada correctamente' });
    renderPantalla();
    llenarValido();
    fireEvent.press(screen.getByText('Guardar contraseña'));

    await waitFor(() => expect(screen.getByText('¡Contraseña actualizada!')).toBeTruthy());
  });
});
