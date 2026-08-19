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
import * as loginDto from '../domain/dtos/login.dto';
import * as tokenDto from '../domain/dtos/token.dto';
import * as changePasswordDto from '../domain/dtos/change-password.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService, // Inyectamos JwtService para decodificar
  ) {}

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
