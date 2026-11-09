import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../application/auth.service';
import { SesionService } from '../application/sesion.service';
import * as loginDto from '../domain/dtos/login.dto';
import * as tokenDto from '../domain/dtos/token.dto';
import * as changePasswordDto from '../domain/dtos/change-password.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sesionService: SesionService,
    private readonly jwtService: JwtService, // Inyectamos JwtService para decodificar
  ) {}

  /**
   * Registra la sesión tras un login hecho en el API de auth (3200).
   *
   * No usa `jwtService.verify`: ese token lo firma otro servicio con otra llave.
   * La validación se delega a `/auth/me` del emisor. Devuelve además las banderas
   * propias de la app (cambio de contraseña, tipo de usuario).
   */
  @Post('sesion')
  async registrarSesion(
    @Headers('authorization') authHeader: string,
    @Headers('x-device-token') deviceToken: string,
  ) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de sesión no proporcionado');
    }
    if (!deviceToken) {
      throw new UnauthorizedException('DeviceToken es requerido');
    }
    return await this.sesionService.registrarSesion(
      authHeader.split(' ')[1],
      deviceToken,
    );
  }

  /**
   * Apaga `RequiereCambioPassword` después de que el usuario cambió su clave en el
   * API de auth, que no conoce esa columna. Sin esto la pantalla saldría siempre.
   */
  @Post('password-cambiada')
  async passwordCambiada(@Headers('authorization') authHeader: string) {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de sesión no proporcionado');
    }
    return await this.sesionService.marcarPasswordCambiada(
      authHeader.split(' ')[1],
    );
  }

  @Post('login')
  async login(
    @Body() body: loginDto.LoginDto,
    @Headers('x-device-token') deviceToken: string,
  ) {
    if (!deviceToken)
      throw new UnauthorizedException('DeviceToken es requerido');
    const validData = loginDto.LoginSchema.parse(body);
    return await this.authService.loguearUsuario(validData, deviceToken);
  }

  // --- NUEVOS ENDPOINTS SPRINT 2 ---

  @Post('refresh')
  async refresh(@Body() body: tokenDto.RefreshTokenDto) {
    const validData = tokenDto.RefreshTokenSchema.parse(body);
    return await this.authService.refrescarToken(validData.refreshToken);
  }

  @Post('logout')
  async logout(@Body() body: tokenDto.RefreshTokenDto) {
    const validData = tokenDto.RefreshTokenSchema.parse(body);
    return await this.authService.cerrarSesion(validData.refreshToken);
  }

  @Get('permisos')
  async getPermisos(@Headers('authorization') authHeader: string) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de sesión no proporcionado');
    }

    const token = authHeader.split(' ')[1];

    try {
      // Decodificamos el JWT para extraer el 'sub' (IdUsuario)
      // Esto valida criptográficamente que el token no haya sido alterado
      const decoded = this.jwtService.verify(token);
      return await this.authService.validarPermisos(decoded.sub);
    } catch (error) {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }

  // Cambio obligatorio de contraseña (primer ingreso). Protegido por JWT: se replica
  // el bloque de verificación de `getPermisos` porque el proyecto no usa Guards.
  @Post('change-password')
  async cambiarPassword(
    @Headers('authorization') authHeader: string,
    @Body() body: changePasswordDto.ChangePasswordDto,
  ) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de sesión no proporcionado');
    }

    const token = authHeader.split(' ')[1];

    // El userId sale del token verificado, NUNCA del body: así un usuario no puede
    // cambiar la contraseña de otro. La validación de firma va antes que la del body.
    let userId: number;
    try {
      const decoded = this.jwtService.verify(token);
      userId = decoded.sub;
    } catch (error) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    const validData = changePasswordDto.ChangePasswordSchema.parse(body);
    return await this.authService.cambiarPassword(userId, validData);
  }
}
