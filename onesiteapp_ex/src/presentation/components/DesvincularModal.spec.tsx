import React from 'react';
import {
  renderConProveedores as render,
  screen,
  fireEvent,
} from '../../../test/render';

import { DesvincularModal } from './DesvincularModal';

/**
 * El modal de desvinculación es la última barrera antes de un wipe destructivo. La
 * desvinculación NO pide contraseña (se autoriza con el device token en el backend);
 * aquí se verifica que advierte de la pérdida de datos pendientes, confirma al pulsar,
 * respeta el estado de carga y muestra el error de red/servidor.
 */

const base = {
  visible: true,
  error: '',
  loading: false,
  capturasSinSubir: 0,
  pendientesMultimedia: 0,
  onConfirmar: jest.fn(),
  onCancelar: jest.fn(),
};

describe('DesvincularModal', () => {
  it('muestra la advertencia de datos pendientes cuando los hay', () => {
    render(<DesvincularModal {...base} capturasSinSubir={3} pendientesMultimedia={2} />);
    expect(screen.getByText(/3 captura\(s\) y 2 archivo\(s\) sin subir/)).toBeTruthy();
  });

  it('NO muestra la advertencia cuando no hay pendientes', () => {
    render(<DesvincularModal {...base} capturasSinSubir={0} pendientesMultimedia={0} />);
    expect(screen.queryByText(/sin subir/)).toBeNull();
  });

  it('pulsar Desvincular confirma', () => {
    const onConfirmar = jest.fn();
    render(<DesvincularModal {...base} onConfirmar={onConfirmar} />);
    fireEvent.press(screen.getByText('Desvincular'));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it('pulsar Cancelar cancela', () => {
    const onCancelar = jest.fn();
    render(<DesvincularModal {...base} onCancelar={onCancelar} />);
    fireEvent.press(screen.getByText('Cancelar'));
    expect(onCancelar).toHaveBeenCalledTimes(1);
  });

  it('muestra el mensaje de error del servidor', () => {
    render(<DesvincularModal {...base} error="No se pudo desvincular el dispositivo" />);
    expect(screen.getByText('No se pudo desvincular el dispositivo')).toBeTruthy();
  });

  it('durante la carga muestra "Desvinculando..." y no confirma', () => {
    const onConfirmar = jest.fn();
    render(<DesvincularModal {...base} loading onConfirmar={onConfirmar} />);
    expect(screen.getByText('Desvinculando...')).toBeTruthy();
    fireEvent.press(screen.getByText('Desvinculando...'));
    expect(onConfirmar).not.toHaveBeenCalled();
  });
});
