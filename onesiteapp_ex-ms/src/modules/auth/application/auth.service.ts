import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { LoginDto } from '../domain/dtos/login.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
  ) {}

  async loguearUsuario(dto: LoginDto, deviceToken: string) {
    // 1. VALIDACIÓN FÍSICA (Regla Crítica: El equipo debe estar activo)
    const dispositivo = await this.dataSource.query(
      `SELECT IdDispositivo, Estado, IdEmpresa FROM Dispositivos_AppEx WHERE DeviceToken = @0`,
      [deviceToken]
    );

    if (!dispositivo.length) {
      throw new ForbiddenException('Dispositivo no registrado'); // 403
    }
    if (!dispositivo[0].Estado) {
      throw new ForbiddenException('Device Blocked'); // 403
    }

    // 2. VALIDACIÓN LÓGICA (Credenciales)
    const usuario = await this.dataSource.query(
      `SELECT IdUsuario, PasswordHash, IdRol, NombreCompleto, Estado, IdEmpresa FROM Usuarios_AppEx WHERE Username = @0`,
      [dto.username]
    );

    // Si el usuario no existe o está dado de baja (Estado = 0)
    if (!usuario.length || !usuario[0].Estado) {
      throw new UnauthorizedException('Credenciales inválidas o usuario inactivo'); // 401
    }

    // Comparamos la contraseña en texto plano enviada por la app contra el Hash de BCrypt
    const isPasswordValid = await bcrypt.compare(dto.password, usuario[0].PasswordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas'); // 401
    }

    // 3. VALIDACIÓN DE PERTENENCIA (Anexo 1, Fase 2 - "Tercero"): el usuario debe
    // trabajar en la misma empresa a la que está vinculado el dispositivo.
    // Los equipos legacy (IdEmpresa NULL, enrolados antes del Sprint 7) se omiten
    // de esta validación para no romperlos; se re-vinculan al volver a enrolar.
    if (
      dispositivo[0].IdEmpresa != null &&
      usuario[0].IdEmpresa != null &&
      Number(dispositivo[0].IdEmpresa) !== Number(usuario[0].IdEmpresa)
    ) {
      throw new ForbiddenException('El usuario no pertenece a la empresa de este dispositivo'); // 403
    }

    // 3. GENERACIÓN DE SESIÓN (Access Token y Refresh Token)
    // Payload del JWT que la app enviará en futuras peticiones
    const payload = { 
      sub: usuario[0].IdUsuario, 
      rol: usuario[0].IdRol 
    };

    // Firmamos el JWT (toma la duración de las variables de entorno)
    const accessToken = this.jwtService.sign(payload);
    
    // Generamos un Refresh Token robusto
    const refreshToken = randomBytes(64).toString('hex');
    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + 15); // +15 días

    // Guardamos la sesión en la base de datos
    await this.dataSource.query(
      `INSERT INTO Sesiones_AppEx (IdUsuario, IdDispositivo, RefreshToken, FechaExpiracion, Activa)
       VALUES (@0, @1, @2, @3, 1)`,
      [usuario[0].IdUsuario, dispositivo[0].IdDispositivo, refreshToken, fechaExpiracion]
    );

    // 4. RETORNO DE RESULTADOS
    return {
      message: 'Autenticación exitosa',
      token_sesion: accessToken,
      refreshToken: refreshToken,
      user_id: usuario[0].IdUsuario,
      nombrecompleto: usuario[0].NombreCompleto,
      id_rol: usuario[0].IdRol,
      estado: usuario[0].Estado
    };
  }

  // 1. Método: RefrescarToken (POST) sprint 2
  async refrescarToken(refreshToken: string) {
    // Buscamos la sesión activa y traemos los datos del usuario unidos (JOIN)
    const session = await this.dataSource.query(
      `SELECT s.IdUsuario, s.FechaExpiracion, s.Activa, u.IdRol, u.Estado 
       FROM Sesiones_AppEx s
       INNER JOIN Usuarios_AppEx u ON s.IdUsuario = u.IdUsuario
       WHERE s.RefreshToken = @0`,
      [refreshToken]
    );

    if (!session.length) {
      throw new UnauthorizedException('Refresh Token no encontrado');
    }

    const { IdUsuario, FechaExpiracion, Activa, IdRol, Estado } = session[0];

    // Validamos que la sesión esté activa, no haya expirado y el usuario siga de alta
    if (!Activa || new Date() > new Date(FechaExpiracion) || !Estado) {
      // Si es inválida, nos aseguramos de marcarla inactiva por seguridad
      await this.cerrarSesion(refreshToken);
      throw new UnauthorizedException('Sesión expirada, inactiva o usuario dado de baja. Inicie sesión nuevamente.');
    }

    // Generamos un nuevo Access Token por 20 minutos
    const payload = { sub: IdUsuario, rol: IdRol };
    const newAccessToken = this.jwtService.sign(payload);

    return {
      message: 'Token refrescado exitosamente',
      token_sesion: newAccessToken,
    };
  }

  // 2. Método: CerrarSesion (POST) - Blacklist
  async cerrarSesion(refreshToken: string) {
    // Marcamos Activa = 0 (Blacklist) en la base de datos
    const result = await this.dataSource.query(
      `UPDATE Sesiones_AppEx 
       SET Activa = 0 
       WHERE RefreshToken = @0 AND Activa = 1`,
      [refreshToken]
    );

    return {
      message: 'Sesión cerrada correctamente. Tokens invalidados.',
    };
  }

  // 3. Método: ValidarPermisos (GET)
  // Nota: Extraemos el userId directamente del AccessToken decodificado en el controlador
  async validarPermisos(userId: number) {
    const permisos = await this.dataSource.query(
      `SELECT r.NombreRol, r.PermisosJSON, r.AccesoLectura, r.AccesoEscritura 
       FROM Usuarios_AppEx u
       INNER JOIN Roles_Permisos_AppEx r ON u.IdRol = r.IdRol
       WHERE u.IdUsuario = @0 AND u.Estado = 1`,
      [userId]
    );

    if (!permisos.length) {
      throw new ForbiddenException('Usuario no encontrado o dado de baja');
    }

    // Retornamos el JSON parseado para que la App lo guarde en SQLite
    return {
      rol: permisos[0].NombreRol,
      accesos: {
        lectura: permisos[0].AccesoLectura,
        escritura: permisos[0].AccesoEscritura,
      },
      permisosGranulares: JSON.parse(permisos[0].PermisosJSON),
    };
  }

}
