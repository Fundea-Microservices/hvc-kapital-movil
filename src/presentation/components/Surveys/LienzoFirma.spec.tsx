import React from 'react';
import { renderConProveedores as render, screen, fireEvent } from '../../../../test/render';

import { LienzoFirma } from './LienzoFirma';

/**
 * El lienzo de firma.
 *
 * Lo que se protege aquí es que **no se pueda aceptar una firma vacía**. Un PNG en
 * blanco guardado como firma tiene todo el aspecto de un dato válido: el token existe,
 * el archivo sube, el BackOffice lo lista. El problema solo aparecería al auditar el
 * expediente, meses después, cuando ya no hay forma de volver con el cliente.
 */

const props = {
  visible: true,
  onCancelar: jest.fn(),
  onFirmar: jest.fn(),
};

describe('LienzoFirma', () => {
  it('invita a firmar cuando el lienzo esta vacio', () => {
    render(<LienzoFirma {...props} />);
    expect(screen.getByText('Dibuje su firma aquí')).toBeTruthy();
    expect(screen.getByText('Firme en el recuadro')).toBeTruthy();
  });

  it('ACEPTAR esta deshabilitado mientras no haya trazo', () => {
    render(<LienzoFirma {...props} />);

    const aceptar = screen.getByText('Aceptar firma');
    fireEvent.press(aceptar);

    // Sin trazo no se genera ningun PNG: el callback no debe dispararse.
    expect(props.onFirmar).not.toHaveBeenCalled();
  });

  it('LIMPIAR tampoco hace nada con el lienzo vacio', () => {
    render(<LienzoFirma {...props} />);
    fireEvent.press(screen.getByText('Limpiar'));
    expect(screen.getByText('Dibuje su firma aquí')).toBeTruthy();
  });

  it('ofrece las dos acciones del pie', () => {
    render(<LienzoFirma {...props} />);
    expect(screen.getByText('Limpiar')).toBeTruthy();
    expect(screen.getByText('Aceptar firma')).toBeTruthy();
  });

  it('no se monta nada cuando visible es false', () => {
    render(<LienzoFirma {...props} visible={false} />);
    expect(screen.queryByText('Firme en el recuadro')).toBeNull();
  });
});
