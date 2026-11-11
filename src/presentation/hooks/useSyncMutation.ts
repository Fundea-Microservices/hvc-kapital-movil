import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { runFullSync } from '../../data/local/services/syncManager';

/**
 * Mutación centralizada de sincronización (TanStack Query).
 *
 * Encapsula `runFullSync` para dotar al envío de capturas de una política de
 * reintentos con retroceso exponencial, pensada para conectividad intermitente de
 * campo: un fallo puntual de red no obliga al asesor a reintentar manualmente.
 *
 * Notas de diseño:
 * - `runFullSync` ya posee un candado interno (`isSyncRunning`), por lo que un
 *   reintento nunca solapa dos ciclos de sincronización.
 * - El envío de capturas es idempotente respecto del estado local: las que se
 *   suben con éxito pasan a `estado_sincro = 1` y dejan de reenviarse.
 */

/** Número de reintentos automáticos ante fallo de red antes de rendirse. */
const REINTENTOS_MAXIMOS = 2;

/** Retroceso exponencial acotado: 2s, 4s… con techo de 15s. */
const calcularEspera = (intento: number): number =>
  Math.min(2000 * 2 ** intento, 15000);

export const useSyncMutation = (): UseMutationResult<void, Error, void, unknown> =>
  useMutation<void, Error, void>({
    mutationKey: ['sincronizacion-completa'],
    mutationFn: async () => {
      await runFullSync();
    },
    retry: REINTENTOS_MAXIMOS,
    retryDelay: calcularEspera,
  });
