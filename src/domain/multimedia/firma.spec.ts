import {
  agregarPuntoFiltrado,
  contarPuntos,
  esFirmaValida,
  esPuntoValido,
  longitudDeTrazo,
  longitudTotal,
  trazoAPath,
  type Trazo,
} from './firma';

/** Trazo recto horizontal de `largo` px, con un punto cada píxel. */
const trazoRecto = (largo: number): Trazo =>
  Array.from({ length: largo + 1 }, (_, i) => ({ x: i, y: 0 }));

describe('esPuntoValido', () => {
  it('rechaza coordenadas no finitas', () => {
    // El gesto puede emitir NaN al salir del area de dibujo.
    expect(esPuntoValido({ x: NaN, y: 0 })).toBe(false);
    expect(esPuntoValido({ x: 0, y: Infinity })).toBe(false);
    expect(esPuntoValido({ x: 0, y: 0 })).toBe(true);
  });
});

describe('longitudDeTrazo', () => {
  it('mide el recorrido acumulado', () => {
    expect(longitudDeTrazo([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
    expect(longitudDeTrazo(trazoRecto(10))).toBe(10);
  });

  it('un solo punto no recorre nada', () => {
    expect(longitudDeTrazo([{ x: 5, y: 5 }])).toBe(0);
    expect(longitudDeTrazo([])).toBe(0);
  });
});

describe('esFirmaValida', () => {
  it('acepta una firma con recorrido suficiente', () => {
    expect(esFirmaValida([trazoRecto(50)])).toBe(true);
  });

  it('rechaza el toque accidental de la palma', () => {
    // Un roce al sostener el dispositivo: sin esto se guardaria un PNG casi en
    // blanco que el asesor creeria valido, y el problema apareceria al auditar.
    expect(esFirmaValida([])).toBe(false);
    expect(esFirmaValida([[{ x: 10, y: 10 }]])).toBe(false);
  });

  it('rechaza muchos puntos SIN recorrido', () => {
    // Tocar repetidamente el mismo sitio acumula puntos pero no dibuja nada.
    const enElSitio: Trazo = Array.from({ length: 40 }, () => ({ x: 7, y: 7 }));
    expect(contarPuntos([enElSitio])).toBeGreaterThan(5);
    expect(esFirmaValida([enElSitio])).toBe(false);
  });

  it('rechaza mucho recorrido con POCOS puntos', () => {
    // Una raya rapidisima: dos puntos muy separados no son una firma.
    expect(esFirmaValida([[{ x: 0, y: 0 }, { x: 500, y: 0 }]])).toBe(false);
  });

  it('suma el recorrido de varios trazos', () => {
    // Una firma real se levanta el dedo varias veces.
    const trazos = [trazoRecto(15), trazoRecto(15), trazoRecto(15)];
    expect(longitudTotal(trazos)).toBe(45);
    expect(esFirmaValida(trazos)).toBe(true);
  });
});

describe('trazoAPath', () => {
  it('devuelve vacio cuando no hay nada dibujable', () => {
    expect(trazoAPath([])).toBe('');
    expect(trazoAPath([{ x: NaN, y: NaN }])).toBe('');
  });

  it('un punto suelto deja marca visible', () => {
    // Apoyar el dedo sin moverlo debe pintar algo, o el usuario cree que la
    // pantalla no responde.
    expect(trazoAPath([{ x: 10, y: 20 }])).toBe('M 10 20 L 10.1 20');
  });

  it('empieza en el primer punto y termina en el ultimo', () => {
    const d = trazoAPath([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('L 20 0')).toBe(true);
  });

  it('usa curvas y no segmentos rectos', () => {
    // Con L la firma sale angulosa y "digital"; con Q parece tinta.
    const d = trazoAPath(trazoRecto(5));
    expect(d).toContain('Q');
  });

  it('descarta los puntos invalidos sin romper el path', () => {
    const d = trazoAPath([{ x: 0, y: 0 }, { x: NaN, y: 5 }, { x: 10, y: 10 }]);
    expect(d).not.toContain('NaN');
    expect(d.startsWith('M 0 0')).toBe(true);
  });

  it('redondea a dos decimales', () => {
    expect(trazoAPath([{ x: 1.23456, y: 2.34567 }])).toContain('M 1.23 2.35');
  });
});

describe('agregarPuntoFiltrado', () => {
  it('descarta los puntos que apenas se movieron', () => {
    // Sin filtrar, un trazo largo acumula miles de puntos y el re-render se
    // vuelve perceptible en gama baja.
    const trazo: Trazo = [{ x: 0, y: 0 }];
    expect(agregarPuntoFiltrado(trazo, { x: 0.5, y: 0 })).toHaveLength(1);
    expect(agregarPuntoFiltrado(trazo, { x: 5, y: 0 })).toHaveLength(2);
  });

  it('siempre acepta el primer punto', () => {
    expect(agregarPuntoFiltrado([], { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
  });

  it('ignora los puntos invalidos', () => {
    const trazo: Trazo = [{ x: 0, y: 0 }];
    expect(agregarPuntoFiltrado(trazo, { x: NaN, y: 1 })).toBe(trazo);
  });
});
