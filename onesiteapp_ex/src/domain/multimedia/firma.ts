/**
 * Geometría de la firma manuscrita.
 *
 * Convierte los puntos que entrega el gesto táctil en trazos dibujables y decide si
 * lo dibujado cuenta como una firma. Es puro —sin React ni SVG— y por eso lo único
 * verificable de la firma sin un dispositivo con pantalla táctil.
 */

export interface Punto {
  x: number;
  y: number;
}

/** Un trazo es lo que se dibuja entre apoyar el dedo y levantarlo. */
export type Trazo = Punto[];

/**
 * Mínimos para considerar que hay una firma y no un toque accidental.
 *
 * Un solo punto es un roce con la palma al sostener el dispositivo; sin recorrido
 * mínimo se guardaría un PNG casi en blanco que el asesor creería válido, y el
 * problema aparecería semanas después al auditar el expediente.
 */
export const PUNTOS_MINIMOS = 5;
export const RECORRIDO_MINIMO = 40;

/** Descarta puntos con coordenadas no finitas (el gesto puede emitir NaN al salir del área). */
export const esPuntoValido = (punto: Punto): boolean =>
  Number.isFinite(punto?.x) && Number.isFinite(punto?.y);

/** Longitud total recorrida por un trazo, en píxeles. */
export const longitudDeTrazo = (trazo: Trazo): number => {
  let total = 0;
  for (let i = 1; i < trazo.length; i += 1) {
    const dx = trazo[i].x - trazo[i - 1].x;
    const dy = trazo[i].y - trazo[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
};

/** Suma del recorrido de todos los trazos. */
export const longitudTotal = (trazos: Trazo[]): number =>
  trazos.reduce((suma, trazo) => suma + longitudDeTrazo(trazo), 0);

export const contarPuntos = (trazos: Trazo[]): number =>
  trazos.reduce((suma, trazo) => suma + trazo.length, 0);

/**
 * Decide si lo dibujado puede guardarse como firma. Exige AMBOS mínimos: un toque
 * repetido en el mismo sitio acumula puntos sin recorrido, y una raya rapidísima
 * acumula recorrido con pocos puntos.
 */
export const esFirmaValida = (trazos: Trazo[]): boolean =>
  contarPuntos(trazos) >= PUNTOS_MINIMOS && longitudTotal(trazos) >= RECORRIDO_MINIMO;

/**
 * Convierte un trazo en el atributo `d` de un `<Path>` de SVG.
 *
 * Usa curvas cuadráticas entre los puntos medios de cada par consecutivo, en vez de
 * segmentos rectos. Con `L` la firma sale angulosa y "digital" a poca frecuencia de
 * muestreo; con este suavizado se parece a un trazo de tinta, que es lo que un
 * expediente firmado debe aparentar.
 *
 * Devuelve cadena vacía si no hay nada dibujable, para que el llamador no genere un
 * `<Path>` inválido.
 */
export const trazoAPath = (trazo: Trazo): string => {
  const puntos = trazo.filter(esPuntoValido);
  if (puntos.length === 0) return '';

  // Un punto suelto se dibuja como un segmento mínimo: sin esto, apoyar el dedo sin
  // moverlo no deja marca y el usuario cree que la pantalla no responde.
  if (puntos.length === 1) {
    const { x, y } = puntos[0];
    return `M ${redondear(x)} ${redondear(y)} L ${redondear(x + 0.1)} ${redondear(y)}`;
  }

  let d = `M ${redondear(puntos[0].x)} ${redondear(puntos[0].y)}`;

  for (let i = 1; i < puntos.length - 1; i += 1) {
    const actual = puntos[i];
    const siguiente = puntos[i + 1];
    const medioX = (actual.x + siguiente.x) / 2;
    const medioY = (actual.y + siguiente.y) / 2;
    d += ` Q ${redondear(actual.x)} ${redondear(actual.y)} ${redondear(medioX)} ${redondear(medioY)}`;
  }

  const ultimo = puntos[puntos.length - 1];
  d += ` L ${redondear(ultimo.x)} ${redondear(ultimo.y)}`;

  return d;
};

/** Dos decimales bastan a resolución de pantalla y acortan mucho el `d`. */
const redondear = (valor: number): number => Math.round(valor * 100) / 100;

/**
 * Reduce la densidad de puntos descartando los que apenas se separan del anterior.
 *
 * Un gesto continuo emite decenas de eventos por segundo: sin filtrar, un trazo largo
 * acumula miles de puntos, el `d` del SVG crece hasta varios cientos de kilobytes y el
 * re-render en cada movimiento se vuelve perceptible en gama baja.
 */
export const agregarPuntoFiltrado = (
  trazo: Trazo,
  punto: Punto,
  distanciaMinima = 1.5,
): Trazo => {
  if (!esPuntoValido(punto)) return trazo;
  if (trazo.length === 0) return [punto];

  const anterior = trazo[trazo.length - 1];
  const dx = punto.x - anterior.x;
  const dy = punto.y - anterior.y;

  if (Math.sqrt(dx * dx + dy * dy) < distanciaMinima) return trazo;
  return [...trazo, punto];
};
