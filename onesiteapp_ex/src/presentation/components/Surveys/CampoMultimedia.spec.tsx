import React from 'react';
import { renderConProveedores as render, screen, waitFor } from '../../../../test/render';

import { CampoMultimedia } from './CampoMultimedia';

/**
 * Lo que ve el asesor cuando una pregunta lleva un archivo adjunto.
 *
 * El punto crítico de este componente no es la captura —eso ya está cubierto por el
 * dominio y por las pruebas de integración— sino **el aviso de que el archivo todavía
 * no ha salido del dispositivo**. La encuesta sincronizada no implica binarios
 * subidos: son ciclos independientes. Si el asesor cree que terminó y libera espacio o
 * devuelve el equipo, la evidencia se pierde.
 */

const contexto = { idEncuesta: '1', idPregunta: '20', uuidBase: 'inst-1', uuidFila: null };

const props = {
  contexto,
  esEditable: true,
  onChangeText: jest.fn(),
  onBlur: jest.fn(),
};

describe('CampoMultimedia — sin archivo', () => {
  it('invita a capturar segun el tipo', async () => {
    render(<CampoMultimedia {...props} tipo="FOTO" valor="" />);
    await waitFor(() => expect(screen.getByText('Tomar foto')).toBeTruthy());
    expect(screen.getByText('Fotografía')).toBeTruthy();
  });

  it('no ofrece capturar cuando el campo no es editable', async () => {
    render(<CampoMultimedia {...props} tipo="DOCUMENTO" valor="" esEditable={false} />);
    await waitFor(() => expect(screen.getByText('Seleccionar archivo')).toBeTruthy());
  });
});

describe('CampoMultimedia — con archivo adjunto', () => {
  const token = 'MEDIA::FOTO::recibo_luz.jpg::248310';

  it('muestra el nombre y el tamano del archivo', async () => {
    render(<CampoMultimedia {...props} tipo="FOTO" valor={token} />);
    await waitFor(() => expect(screen.getByText('recibo_luz.jpg')).toBeTruthy());
    // 248310 bytes se presentan como KB, no como una cifra ilegible.
    expect(screen.getByText(/242 KB/)).toBeTruthy();
  });

  it('AVISA de que el archivo aun no se ha enviado', async () => {
    // Es el mensaje que evita que el asesor de por terminado su trabajo con
    // evidencia todavia en cola.
    render(<CampoMultimedia {...props} tipo="FOTO" valor={token} />);
    await waitFor(() =>
      expect(screen.getByText(/Se enviará en la próxima sincronización/)).toBeTruthy(),
    );
    expect(screen.getByText(/Pendiente de envío/)).toBeTruthy();
  });

  it('un valor que NO es un token se trata como si no hubiera archivo', async () => {
    // El discriminador es el propio token: una respuesta de texto normal jamas debe
    // interpretarse como un adjunto.
    render(<CampoMultimedia {...props} tipo="FOTO" valor="Juan Perez" />);
    await waitFor(() => expect(screen.getByText('Tomar foto')).toBeTruthy());
    expect(screen.queryByText(/Pendiente de envío/)).toBeNull();
  });

  it('un documento muestra su nombre aunque no haya miniatura', async () => {
    render(<CampoMultimedia {...props} tipo="DOCUMENTO" valor="MEDIA::DOCUMENTO::acta.pdf::5120" />);
    await waitFor(() => expect(screen.getByText('acta.pdf')).toBeTruthy());
    expect(screen.getByText(/5 KB/)).toBeTruthy();
  });
});
