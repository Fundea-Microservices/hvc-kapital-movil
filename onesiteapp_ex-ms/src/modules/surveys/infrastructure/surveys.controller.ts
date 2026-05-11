import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
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
    @Headers('x-user-id') userId: string
  ) {
    if (!deviceToken) throw new UnauthorizedException('Dispositivo no autenticado');
    return await this.surveysService.submitSurvey(Number(userId), payload);
  }
  
}