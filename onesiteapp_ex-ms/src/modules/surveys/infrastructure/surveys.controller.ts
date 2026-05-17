import { Controller, Post, Body, Headers, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { SurveysService } from '../application/surveys.service';

@Controller('api/v1/surveys')
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}
  /**
   * El controlador expone el servicio S1.4 getSurveyStructure.
   * Se requiere el DeviceToken para asegurar la arquitectura Zero Trust.
   */
  @Post('structure')
  async syncStructure(
    @Body('lastSyncDate') lastSyncDate: string | null,
    @Headers('x-device-token') deviceToken: string
  ) {
    if (!deviceToken) throw new UnauthorizedException('Dispositivo no autenticado');
    return await this.surveysService.getSurveyStructure(lastSyncDate);
  }
  /**
   * El controlador expone el servicio S2.1 de Catálogos.
   */
  @Post('catalogs')
  async syncCatalogs(
    @Body('lastSyncDate') lastSyncDate: string | null,
    @Headers('x-device-token') deviceToken: string
  ) {
    if (!deviceToken) throw new UnauthorizedException('Dispositivo no autenticado');
    return await this.surveysService.getCatalogs(lastSyncDate);
  }
  /**
   * El controlador expone el endpoint 1.7 sendSurvey para la recepción de datos.
   */
  @Post('submit')
 async submit(
    @Body() payload: any,
    @Headers('x-device-token') deviceToken: string,
    @Headers('x-user-id') headerUserId: string // Cambiamos el nombre para no confundir
  ) {
    if (!deviceToken) throw new UnauthorizedException('Dispositivo no autenticado');
    
    // 1. EL FIX: Extraemos el ID del usuario desde el payload (Frontend) o desde el Header
    const finalUserId = payload.IdUsuario || headerUserId;

    // 2. Validación de seguridad
    if (!finalUserId || isNaN(Number(finalUserId))) {
      console.error("❌ Petición rechazada: No se encontró IdUsuario válido.", { payload, headerUserId });
      throw new BadRequestException('Falta el IdUsuario en el payload o es inválido');
    }

    // 3. Ejecución del servicio (Ya enviamos un número real, nunca un NaN/NULL)
    return await this.surveysService.submitSurvey(Number(finalUserId), payload);
  }
}