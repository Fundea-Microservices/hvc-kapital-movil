import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { database } from '../../data/local/database';
import { recargarEncuesta, type ResultadoPrecarga } from '../../data/local/services/clientesAsignados.service';

/**
 * Recarga bajo demanda de la cartera de UNA encuesta (botón "Cargar datos").
 *
 * Consume `useMutation`, así que el componente que lo use debe montarse DENTRO del
 * `QueryClientProvider` — un error que no aparece al compilar, solo en ejecución.
 *
 * `recargarEncuesta` NUNCA lanza: clasifica el fallo y lo devuelve en `motivo`. Por eso
 * el reintento se configura mirando `resultado.ok` en vez de esperar una excepción; un
 * fallo de red merece reintento, pero uno de configuración no lo arregla insistir.
 */

/** Reintentos automáticos ante fallo de red antes de rendirse. */
const REINTENTOS_MAXIMOS = 2;

/** Retroceso exponencial acotado: 2s, 4s… con techo de 15s. */
const calcularEspera = (intento: number): number => Math.min(2000 * 2 ** intento, 15000);

export const useCargarClientesAsignados = (
  idEncuesta: string,
): UseMutationResult<ResultadoPrecarga, Error, void, unknown> =>
  useMutation<ResultadoPrecarga, Error, void>({
    mutationKey: ['cartera-clientes', idEncuesta],
    mutationFn: async () => {
      const resultado = await recargarEncuesta(database, idEncuesta);
      // Se convierte en excepción SOLO el fallo transitorio, para que TanStack Query
      // aplique el retroceso. Un `SIN_CONFIGURAR` se devuelve como resultado normal:
      // reintentarlo gastaría datos del asesor sin ninguna posibilidad de éxito.
      if (!resultado.ok && resultado.motivo === 'SIN_RED') {
        throw new Error('SIN_RED');
      }
      return resultado;
    },
    retry: (intento, error) => error.message === 'SIN_RED' && intento < REINTENTOS_MAXIMOS,
    retryDelay: calcularEspera,
  });
