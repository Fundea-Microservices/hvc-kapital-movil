import { mapearRespuestaLogin, resolverFotoPerfil, type RespuestaLoginAuthApi } from './auth.api';

const respuestaValida: RespuestaLoginAuthApi = {
  success: true,
  message: 'Login successful',
  data: {
    token: 'jwt.de.prueba',
    user: {
      id: '4A7E5179-48BF-4A45-8A5F-27E276AF1756',
      userName: 'admin1',
      nombreCompleto: 'Administrador 1',
      fotoUrl: 'storage/perfil/admin1.png',
      activo: true,
      rol: { nombre: 'Administrador', esAdmin: true },
    },
  },
};

describe('mapearRespuestaLogin', () => {
  it('traduce la respuesta del API de auth al contrato de la app', () => {
    const resultado = mapearRespuestaLogin(respuestaValida);

    expect(resultado.token_sesion).toBe('jwt.de.prueba');
    expect(resultado.user_id).toBe('4A7E5179-48BF-4A45-8A5F-27E276AF1756');
    expect(resultado.nombrecompleto).toBe('Administrador 1');
    expect(resultado.usuario).toBe('admin1');
    expect(resultado.rol).toBe('Administrador');
    expect(resultado.fotoUrl).toBe('storage/perfil/admin1.png');
  });

  it('no emite refresh token ni fuerza cambio de contraseña', () => {
    const resultado = mapearRespuestaLogin(respuestaValida);

    expect(resultado.refreshToken).toBe('');
    expect(resultado.requiereCambioPassword).toBe(false);
  });

  it('marca inactivo al usuario dado de baja', () => {
    const inactivo = {
      ...respuestaValida,
      data: { ...respuestaValida.data, user: { ...respuestaValida.data!.user, activo: false } },
    };

    expect(mapearRespuestaLogin(inactivo).estado).toBe(0);
  });

  it('falla si el servidor no devuelve token', () => {
    const sinToken = { ...respuestaValida, data: { user: respuestaValida.data!.user } };

    expect(() => mapearRespuestaLogin(sinToken)).toThrow('token o usuario');
  });

  it('falla si el servidor no devuelve usuario', () => {
    expect(() => mapearRespuestaLogin({ success: true, data: { token: 'x' } })).toThrow('token o usuario');
  });

  it('usa el userName cuando no hay nombre completo', () => {
    const sinNombre = {
      ...respuestaValida,
      data: { ...respuestaValida.data, user: { id: 'guid', userName: 'admin1' } },
    };

    expect(mapearRespuestaLogin(sinNombre).nombrecompleto).toBe('admin1');
  });
});

describe('resolverFotoPerfil', () => {
  beforeAll(() => {
    process.env.EXPO_PUBLIC_API_AUTH_URL = 'http://172.25.5.11:3200/v1';
  });

  it('devuelve null cuando el usuario no tiene foto', () => {
    expect(resolverFotoPerfil(null)).toBeNull();
    expect(resolverFotoPerfil('')).toBeNull();
  });

  it('respeta una URL absoluta', () => {
    expect(resolverFotoPerfil('https://cdn/foto.png')).toBe('https://cdn/foto.png');
  });

  it('resuelve la ruta relativa contra el origen, sin la versión del API', () => {
    expect(resolverFotoPerfil('storage/perfil/admin1.png'))
      .toBe('http://172.25.5.11:3200/storage/perfil/admin1.png');
  });
});
