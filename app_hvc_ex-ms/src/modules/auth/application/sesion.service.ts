import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/** Lo que la app necesita saber y que el API de auth (3200) no devuelve. */
export interface BanderasSesion {
  requiereCambioPassword: boolean;
  tipoUsuario: string | null;
}

interface RespuestaMe {
  data?: { id?: string } | null;
}

/**
 * Registra la sesión de un usuario en un equipo concreto.
 *
 * El login ocurre fuera (API de auth, puerto 3200), así que `app.Sesiones` dejó de
 * llenarse sola. Este servicio la llena cuando la app se presenta con su JWT, para
 * conservar el corte remoto desde el BackOffice.
 */
@Injectable()
export class SesionService {
  private readonly logger = new Logger(SesionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Verifica el token DELEGANDO en el propio emisor: nuestro backend no conoce su
   * llave de firma. Si `/auth/me` lo acepta, el token es válido y nos dice quién es.
   */
  private async identificarUsuario(tokenBearer: string): Promise<string> {
    const base = this.configService.get<string>('AUTH_API_URL');
    if (!base) {
      throw new ServiceUnavailableException('AUTH_API_URL no está configurada');
    }

    const url = `${base.replace(/\/$/, '')}/auth/me`;
    let respuesta: Response;
    try {
      respuesta = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${tokenBearer}`,
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      // El API de auth caído no debe parecer un token inválido: son fallas distintas.
      this.logger.warn(
        `No se pudo consultar ${url}: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw new ServiceUnavailableException(
        'El servicio de autenticación no respondió',
      );
    }

    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    if (!respuesta.ok) {
      throw new ServiceUnavailableException(
        `El servicio de autenticación respondió ${respuesta.status}`,
      );
    }

    const cuerpo = (await respuesta.json()) as RespuestaMe;
    const idUsuario = cuerpo?.data?.id;
    if (!idUsuario) {
      throw new UnauthorizedException(
        'El token no identifica a ningún usuario',
      );
    }
    return idUsuario;
  }

  async registrarSesion(
    tokenBearer: string,
    deviceToken: string,
  ): Promise<BanderasSesion & { message: string }> {
    const idUsuario = await this.identificarUsuario(tokenBearer);

    const dispositivo = await this.dataSource.query<
      Array<{ IdDispositivo: number; Estado: boolean }>
    >(
      `SELECT IdDispositivo, Estado FROM app.Dispositivos WHERE DeviceToken = @0`,
      [deviceToken],
    );

    if (!dispositivo.length) {
      throw new NotFoundException('Dispositivo no encontrado');
    }
    if (!dispositivo[0].Estado) {
      throw new UnauthorizedException('Dispositivo bloqueado (Device Blocked)');
    }

    // El registro de la sesión es SECUNDARIO: sirve para el corte remoto. Las
    // banderas gobiernan qué ve el usuario al entrar. Si un detalle del esquema
    // de app.Sesiones falla, no puede arrastrarse la bandera de cambio de
    // contraseña: el endpoint daría 500 y el usuario entraría sin que se la pidan.
    let sesionRegistrada = true;
    try {
      // Una sesión activa por usuario: entrar en otro equipo apaga la anterior.
      await this.dataSource.query(
        `UPDATE app.Sesiones SET Activa = 0 WHERE IdUsuario = @0 AND Activa = 1`,
        [idUsuario],
      );

      // La expiración refleja la vida del JWT del emisor (~1h), no una sesión propia.
      await this.dataSource.query(
        `INSERT INTO app.Sesiones (IdUsuario, IdDispositivo, RefreshToken, FechaInicio, FechaExpiracion, Activa)
         VALUES (@0, @1, NULL, GETDATE(), DATEADD(HOUR, 1, GETDATE()), 1)`,
        [idUsuario, dispositivo[0].IdDispositivo],
      );
    } catch (e) {
      sesionRegistrada = false;
      this.logger.error(
        `[SESION] No se pudo registrar la sesión de ${idUsuario}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return {
      message: sesionRegistrada
        ? 'Sesión registrada'
        : 'Sesión no registrada; banderas entregadas',
      ...(await this.leerBanderas(idUsuario)),
    };
  }

  /**
   * Apaga la bandera de cambio obligatorio tras un cambio de contraseña exitoso.
   *
   * El API de auth (3200) cambia la clave pero no conoce esta columna, así que sin
   * esto la pantalla volvería a salir en cada login. Se identifica al usuario por
   * su token: nadie puede apagar la bandera de otro.
   */
  async marcarPasswordCambiada(tokenBearer: string) {
    const idUsuario = await this.identificarUsuario(tokenBearer);

    await this.dataSource.query(
      `UPDATE auth.Usuario SET RequiereCambioPassword = 0 WHERE id = @0`,
      [idUsuario],
    );

    this.logger.log(
      `[SESION] ${idUsuario} ya no requiere cambio de contraseña`,
    );
    return { message: 'Bandera de cambio de contraseña apagada' };
  }

  /** Banderas propias de la app que viven en `auth.Usuario` y el 3200 no expone. */
  private async leerBanderas(idUsuario: string): Promise<BanderasSesion> {
    const filas = await this.dataSource.query<
      Array<{
        RequiereCambioPassword: boolean | number | null;
        TipoUsuario: string | null;
      }>
    >(
      `SELECT TOP 1 RequiereCambioPassword, TipoUsuario
       FROM auth.Usuario WHERE id = @0`,
      [idUsuario],
    );

    if (!filas.length) {
      return { requiereCambioPassword: false, tipoUsuario: null };
    }

    // El BIT llega como boolean o como 1/0 segun el driver: se acepta cualquiera.
    const bandera = filas[0].RequiereCambioPassword;
    this.logger.log(
      `[SESION] ${idUsuario} requiereCambioPassword=${String(bandera)} tipo=${String(filas[0].TipoUsuario)}`,
    );

    return {
      requiereCambioPassword: bandera === true || bandera === 1,
      // Se normaliza aquí porque la columna no tiene CHECK: el BackOffice puede
      // guardar espacios o minúsculas y la app compara contra constantes.
      tipoUsuario: filas[0].TipoUsuario
        ? filas[0].TipoUsuario.trim().toUpperCase()
        : null,
    };
  }
}
