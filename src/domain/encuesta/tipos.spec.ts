import { tipoMedioDe, esTipoMedio, ALIAS_TIPO_MEDIO } from './tipos';

describe('tipoMedioDe', () => {
  it('reduce los alias de camara a la familia FOTO', () => {
    ['FOTO', 'CAMARA', 'Fotografia', '  foto  '].forEach(t =>
      expect(tipoMedioDe(t)).toBe('FOTO'),
    );
  });

  it('reduce galeria, imagen y video a MULTIMEDIA', () => {
    ['MULTIMEDIA', 'IMAGEN', 'VIDEO', 'galeria'].forEach(t =>
      expect(tipoMedioDe(t)).toBe('MULTIMEDIA'),
    );
  });

  it('VIDEO deja de caer al default', () => {
    // Regresion: sin la tabla de alias, VIDEO no coincidia con ninguna rama del
    // switch y la pantalla renderizaba un TextInput de texto libre.
    expect(esTipoMedio('VIDEO')).toBe(true);
  });

  it('reduce los alias de archivo a DOCUMENTO', () => {
    ['FILE', 'DOCUMENTO', 'ARCHIVO', 'adjunto'].forEach(t =>
      expect(tipoMedioDe(t)).toBe('DOCUMENTO'),
    );
  });

  it('FIRMA se reconoce aunque su captura siga pendiente', () => {
    // El entorno esta preparado de punta a punta; solo falta el lienzo.
    expect(tipoMedioDe('FIRMA')).toBe('FIRMA');
  });

  it('devuelve null para los tipos que no capturan archivos', () => {
    ['TEXTO', 'NUMERO', 'SELECT', 'MATRIZ', 'CALCULO', 'LABEL', '', null, undefined].forEach(t =>
      expect(tipoMedioDe(t)).toBeNull(),
    );
  });

  it('la tabla solo produce las cuatro familias soportadas', () => {
    Object.values(ALIAS_TIPO_MEDIO).forEach(familia =>
      expect(['FOTO', 'MULTIMEDIA', 'DOCUMENTO', 'FIRMA']).toContain(familia),
    );
  });
});
