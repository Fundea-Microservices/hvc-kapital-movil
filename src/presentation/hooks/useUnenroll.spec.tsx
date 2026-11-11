import { renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import { useUnenroll } from './useUnenroll';
import { desvincularDispositivoApi } from '../../data/remote/auth.api';
import { wipeLocalDatabase } from '../../data/local/services/database.service';
import { useAuthStore } from '../store/useAuthStore';

/**
 * La desvinculación es la ÚNICA salida que tiene el asesor cuando su equipo quedó
 * enrolado contra un backend que ya no lo reconoce (repunte de ambiente, base
 * recreada). Lo que se verifica aquí es el contrato de esa salida: el servidor sigue
 * siendo autoritativo para un rechazo real, pero un 404 no puede dejar al equipo
 * atrapado entre un Login que responde 403 y un Desvincular que falla.
 */

// El store persiste con AsyncStorage, cuyo módulo nativo no existe en Jest.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../../data/remote/auth.api', () => ({
  desvincularDispositivoApi: jest.fn(),
}));

jest.mock('../../data/local/services/database.service', () => ({
  wipeLocalDatabase: jest.fn(async () => undefined),
}));

const apiMock = desvincularDispositivoApi as jest.MockedFunction<
  typeof desvincularDispositivoApi
>;

/** Error tal como lo propaga axios: lo que distingue el caso es el status, no el texto. */
const errorHttp = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { message: 'Dispositivo no encontrado' } },
  });

describe('useUnenroll', () => {
  beforeEach(() => {
    useAuthStore.setState({ isEnrolled: true, isLoggedIn: true });
  });

  it('borra el equipo cuando el servidor confirma la desvinculación', async () => {
    apiMock.mockResolvedValueOnce({ message: 'Dispositivo desvinculado' });

    const { result } = renderHook(() => useUnenroll());
    await result.current.executeUnenroll();

    expect(wipeLocalDatabase).toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('deviceToken');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('isEnrolled');
    await waitFor(() => expect(useAuthStore.getState().isEnrolled).toBe(false));
  });

  it('borra el equipo igual si el servidor no lo conoce (404)', async () => {
    apiMock.mockRejectedValueOnce(errorHttp(404));

    const { result } = renderHook(() => useUnenroll());
    await result.current.executeUnenroll();

    expect(wipeLocalDatabase).toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('deviceToken');
    await waitFor(() => expect(useAuthStore.getState().isEnrolled).toBe(false));
  });

  it('NO borra nada si el servidor rechaza por otra razón', async () => {
    apiMock.mockRejectedValueOnce(errorHttp(401));

    const { result } = renderHook(() => useUnenroll());
    await expect(result.current.executeUnenroll()).rejects.toThrow();

    expect(wipeLocalDatabase).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isEnrolled).toBe(true);
  });
});
