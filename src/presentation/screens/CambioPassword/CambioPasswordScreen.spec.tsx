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

// Tras el cambio OBLIGATORIO, la pantalla cierra la sesión (→ Login) vía useLogout. Se
// mockea para aseverar que se invoca, sin ejecutar el logout real (SecureStore/backend).
const mockLogout = jest.fn(async () => undefined);
jest.mock('../../hooks/useLogout', () => ({
  useLogout: () => ({ executeLogout: mockLogout }),
}));

// SecureStore solo se toca en el camino de éxito del modo OBLIGATORIO (borra la
// bandera). Se neutraliza para poder aseverar que el modo voluntario NO lo llama.
jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(async () => undefined),
}));

import * as SecureStore from 'expo-secure-store';

const mockCambiar = cambiarPasswordApi as jest.MockedFunction<typeof cambiarPasswordApi>;
const mockBorrarFlag = SecureStore.deleteItemAsync as jest.MockedFunction<typeof SecureStore.deleteItemAsync>;

const renderPantalla = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CambioPasswordScreen />
    </QueryClientProvider>
  );
};

// Render en modo VOLUNTARIO: se pasan `route` con el flag y un `navigation` mock.
const renderVoluntario = () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const goBack = jest.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <CambioPasswordScreen
        route={{ params: { voluntario: true } } as never}
        navigation={{ goBack } as never}
      />
    </QueryClientProvider>
  );
  return { ...utils, goBack };
};

// Rellena los tres campos con una combinación que cumple las siete reglas.
const llenarValido = () => {
  fireEvent.changeText(screen.getByPlaceholderText('Ingrese su contraseña actual'), 'Temporal1!');
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
    fireEvent.changeText(screen.getByPlaceholderText('Ingrese su contraseña actual'), 'Temporal1!');
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
      expect.anything(),
      // Tercer argumento: GUID del usuario, que el API de auth exige en el cuerpo.
      expect.anything()
    );
  });
});

describe('CambioPasswordScreen — error del servidor', () => {
  it('muestra "actual incorrecta" cuando el backend responde 401', async () => {
    // `isAxiosError` reconoce el objeto por la marca `isAxiosError: true` (axios v1);
    // el mensaje se decide por STATUS, no por el texto crudo del backend.
    mockCambiar.mockRejectedValueOnce({ isAxiosError: true, response: { status: 401, data: {} } });
    renderPantalla();
    llenarValido();
    fireEvent.press(screen.getByText('Guardar contraseña'));

    await waitFor(() =>
      expect(screen.getByText('La contraseña actual no es correcta')).toBeTruthy()
    );
  });

  it('muestra el genérico y NO el texto crudo del backend ante un error inesperado', async () => {
    // Un backend distinto podría devolver "NO SE LOGRO REALIZAR EL CAMBIO..."; ese texto
    // no debe llegar al usuario: se muestra el mensaje controlado por nosotros.
    mockCambiar.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { message: 'NO SE LOGRO REALIZAR EL CAMBIO DE CONTRSEÑA INTENTE MAS TARDE' } },
    });
    renderPantalla();
    llenarValido();
    fireEvent.press(screen.getByText('Guardar contraseña'));

    await waitFor(() => expect(screen.getByText('No se pudo actualizar la contraseña')).toBeTruthy());
    expect(screen.queryByText(/INTENTE MAS TARDE/)).toBeNull();
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

  it('en el primer ingreso, "Continuar" cierra la sesión para reingresar (→ Login)', async () => {
    mockCambiar.mockResolvedValueOnce({ message: 'Contraseña actualizada correctamente' });
    renderPantalla();
    llenarValido();
    fireEvent.press(screen.getByText('Guardar contraseña'));

    await waitFor(() => expect(screen.getByText('¡Contraseña actualizada!')).toBeTruthy());
    fireEvent.press(screen.getByText('Continuar'));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });
});

describe('CambioPasswordScreen — modo voluntario (desde Perfil)', () => {
  it('muestra el botón atrás, que no existe en el modo obligatorio', () => {
    renderVoluntario();
    expect(screen.getByText('Volver')).toBeTruthy();
  });

  it('el modo obligatorio NO muestra botón atrás (es una barrera)', () => {
    renderPantalla();
    expect(screen.queryByText('Volver')).toBeNull();
  });

  it('al confirmar el éxito vuelve atrás y NO borra la bandera de primer ingreso', async () => {
    mockCambiar.mockResolvedValueOnce({ message: 'Contraseña actualizada correctamente' });
    const { goBack } = renderVoluntario();
    llenarValido();
    fireEvent.press(screen.getByText('Guardar contraseña'));

    await waitFor(() => expect(screen.getByText('¡Contraseña actualizada!')).toBeTruthy());
    fireEvent.press(screen.getByText('Continuar'));

    await waitFor(() => expect(goBack).toHaveBeenCalledTimes(1));
    // La bandera de primer ingreso es ajena a este flujo: no debe tocarse.
    expect(mockBorrarFlag).not.toHaveBeenCalled();
  });
});
