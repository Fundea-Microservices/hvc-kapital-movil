import { useEffect, useRef } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as SecureStore from 'expo-secure-store';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../data/local/database';
import { useSyncMutation } from '../hooks/useSyncMutation';

/**
 * Componente sin interfaz que reintenta la sincronización al recuperar señal (S5.2).
 *
 * Debe renderizarse DENTRO del `QueryClientProvider`: usa `useSyncMutation`, y los
 * hooks de TanStack Query requieren el proveedor en un ancestro. Por eso la lógica
 * no vive en `App.tsx`, que es quien monta dicho proveedor.
 *
 * Solo actúa en la transición offline → online y únicamente si existe una sesión
 * activa y capturas finalizadas pendientes de envío (`estado_sincro = 0`).
 */
export const SyncOnReconnect = () => {
  const sincronizacion = useSyncMutation();

  // Se guarda en una referencia para que el efecto no dependa del objeto de la
  // mutación (cambia en cada render) y así el listener se suscriba una sola vez.
  const sincronizacionRef = useRef(sincronizacion);
  sincronizacionRef.current = sincronizacion;

  useEffect(() => {
    let estabaOffline = false;

    const cancelarSuscripcion = NetInfo.addEventListener(async (estado) => {
      const enLinea = !!estado.isConnected && estado.isInternetReachable !== false;

      if (!enLinea) {
        estabaOffline = true;
        return;
      }
      if (!estabaOffline) return; // Solo interesa el flanco offline → online
      estabaOffline = false;

      try {
        const sesion = await SecureStore.getItemAsync('token_sesion');
        if (!sesion) return; // Sin sesión activa no hay nada que subir

        const pendientes = await database.collections
          .get('local_captura')
          .query(Q.where('estado_sincro', 0))
          .fetchCount();

        // mutate (no mutateAsync) para no propagar el rechazo: TanStack ya
        // gestiona los reintentos y el error queda registrado en la mutación.
        if (pendientes > 0) sincronizacionRef.current.mutate();
      } catch (e) {
        console.warn('[NET] No se pudo evaluar el reintento de sincronización:', e);
      }
    });

    return () => cancelarSuscripcion();
  }, []);

  return null;
};
