import { useEffect, useState } from 'react';

/**
 * Devuelve `valor` con retardo: solo se propaga cuando deja de cambiar durante `espera`.
 *
 * POR QUÉ HACE FALTA EN LA AGENDA
 * Filtrar la cartera recorre y compara cada fila. Con la cantidad de clientes que
 * maneja un asesor, hacerlo en cada pulsación bloquearía el hilo de JS mientras se
 * teclea. Posponiendo el valor, el `useMemo` del filtro se recalcula una vez por
 * consulta asentada y no una vez por letra.
 *
 * El campo de texto sigue siendo controlado por el valor INMEDIATO —el cursor y el
 * texto responden al instante—; lo único que se pospone es el filtrado.
 */
export const useValorPospuesto = <T>(valor: T, espera = 250): T => {
  const [pospuesto, setPospuesto] = useState<T>(valor);

  useEffect(() => {
    const temporizador = setTimeout(() => setPospuesto(valor), espera);
    // Limpiar en cada cambio es lo que produce el efecto: mientras se siga tecleando,
    // el temporizador anterior se cancela y nunca llega a disparar.
    return () => clearTimeout(temporizador);
  }, [valor, espera]);

  return pospuesto;
};
