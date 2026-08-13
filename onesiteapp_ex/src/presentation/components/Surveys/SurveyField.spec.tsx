import React from 'react';
import { renderConProveedores as render, screen } from '../../../../test/render';

import { SurveyField } from './SurveyField';

/**
 * Pruebas del renderizado polimórfico.
 *
 * `SurveyField` decide, a partir de `tipo_dato`, qué control se le presenta al asesor.
 * Es una decisión sin lógica de negocio pero con consecuencias directas: cuando un
 * tipo no coincide con ninguna rama cae al `default`, que dibuja un campo de texto
 * libre — y el asesor teclea a mano lo que debía elegir de una lista o adjuntar como
 * archivo. Ese fallo estuvo activo con `VIDEO` hasta el Sprint 10 y nadie lo detectó,
 * porque no había ninguna prueba de esta capa.
 */

const props = {
  etiqueta: 'Pregunta de prueba',
  esObligatorio: false,
  esEditable: true,
  valor: '',
  onChangeText: jest.fn(),
  onBlur: jest.fn(),
};

const contexto = {
  idEncuesta: '1',
  idPregunta: '20',
  uuidBase: 'inst-1',
  uuidFila: null,
};

describe('SurveyField — la etiqueta y el obligatorio', () => {
  it('muestra la etiqueta de la pregunta', () => {
    render(<SurveyField {...props} tipoDato="TEXTO" />);
    expect(screen.getByText(/Pregunta de prueba/)).toBeTruthy();
  });

  it('marca con asterisco las preguntas obligatorias', () => {
    render(<SurveyField {...props} tipoDato="TEXTO" esObligatorio />);
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('un LABEL no repite la cabecera ni lleva asterisco', () => {
    // Un tipo informativo ya pinta su propio texto: repetirlo lo mostraria dos veces,
    // y el asterisco sugeriria que hay algo que llenar.
    render(<SurveyField {...props} tipoDato="LABEL" etiqueta="Solo informativo" esObligatorio />);
    expect(screen.getAllByText('Solo informativo')).toHaveLength(1);
    expect(screen.queryByText('*')).toBeNull();
  });
});

describe('SurveyField — cada tipo cae en su rama', () => {
  it('los tipos de texto renderizan un campo editable', () => {
    render(<SurveyField {...props} tipoDato="TEXTO" />);
    expect(screen.getByPlaceholderText('Escriba aquí...')).toBeTruthy();
  });

  it('un campo no editable no ofrece marcador de escritura', () => {
    render(<SurveyField {...props} tipoDato="TEXTO" esEditable={false} />);
    expect(screen.queryByPlaceholderText('Escriba aquí...')).toBeNull();
  });

  it('COORDENADAS muestra el estado de la captura de GPS', () => {
    render(<SurveyField {...props} tipoDato="COORDENADAS" />);
    expect(screen.getByText('Sin capturar')).toBeTruthy();
  });

  it.each(['FOTO', 'CAMARA', 'FOTOGRAFIA'])(
    '%s ofrece tomar una foto, no un campo de texto',
    tipo => {
      render(<SurveyField {...props} tipoDato={tipo} contextoCaptura={contexto} />);
      expect(screen.getByText('Tomar foto')).toBeTruthy();
      expect(screen.queryByPlaceholderText('Escriba aquí...')).toBeNull();
    },
  );

  it.each(['MULTIMEDIA', 'IMAGEN', 'GALERIA'])('%s abre la galería', tipo => {
    render(<SurveyField {...props} tipoDato={tipo} contextoCaptura={contexto} />);
    expect(screen.getByText('Elegir de la galería')).toBeTruthy();
  });

  it('VIDEO ya NO cae al campo de texto libre', () => {
    // Regresion del Sprint 10: VIDEO no coincidia con ninguna rama del switch, asi
    // que el asesor veia un cuadro de escritura donde debia adjuntar un video.
    render(<SurveyField {...props} tipoDato="VIDEO" contextoCaptura={contexto} />);
    expect(screen.queryByPlaceholderText('Escriba aquí...')).toBeNull();
    expect(screen.getByText('Elegir de la galería')).toBeTruthy();
  });

  it.each(['FILE', 'DOCUMENTO', 'ARCHIVO', 'ADJUNTO'])('%s abre el selector de archivos', tipo => {
    render(<SurveyField {...props} tipoDato={tipo} contextoCaptura={contexto} />);
    expect(screen.getByText('Seleccionar archivo')).toBeTruthy();
  });

  it('FIRMA ofrece firmar', () => {
    render(<SurveyField {...props} tipoDato="FIRMA" contextoCaptura={contexto} />);
    expect(screen.getByText('Firmar')).toBeTruthy();
  });

  it('un tipo desconocido cae al texto libre, que es el respaldo razonable', () => {
    render(<SurveyField {...props} tipoDato="TIPO_QUE_NO_EXISTE" />);
    expect(screen.getByPlaceholderText('Escriba aquí...')).toBeTruthy();
  });
});

describe('SurveyField — multimedia sin contexto', () => {
  it('avisa en vez de guardar un adjunto huerfano', () => {
    // Sin contexto no se sabe a que respuesta pertenece el archivo. Guardarlo
    // produciria un binario que nadie podria asociar a nada.
    render(<SurveyField {...props} tipoDato="FOTO" />);
    expect(screen.getByText(/no disponible en este contexto/i)).toBeTruthy();
    expect(screen.queryByText('Tomar foto')).toBeNull();
  });
});

describe('SurveyField — mensajes al asesor', () => {
  it('muestra el aviso informativo cuando se pasa', () => {
    render(
      <SurveyField {...props} tipoDato="CALCULO" mensajeInfo="Calculado automáticamente" />,
    );
    expect(screen.getByText('Calculado automáticamente')).toBeTruthy();
  });
});
