import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { SurveysService } from '../application/surveys.service';
import { CatalogosExternosService } from '../application/catalogos-externos.service';

@Controller('api/v1/surveys')
export class SurveysController {
  constructor(
    private readonly surveysService: SurveysService,
    private readonly catalogosExternosService: CatalogosExternosService,
  ) {}
  /**
   * El controlador expone el servicio S1.4 getSurveyStructure.
   * Se requiere el DeviceToken para asegurar la arquitectura Zero Trust.
   */
  @Post('structure')
  async syncStructure(
    @Body('lastSyncDate') lastSyncDate: string | null,
    @Headers('x-device-token') deviceToken: string,
  ) {
    if (!deviceToken)
      throw new UnauthorizedException('Dispositivo no autenticado');
    return await this.surveysService.getSurveyStructure(lastSyncDate);
  }
  /**
   * El controlador expone el servicio S2.1 de Catálogos.
   */
  @Post('catalogs')
  async syncCatalogs(
    @Body('lastSyncDate') lastSyncDate: string | null,
    @Headers('x-device-token') deviceToken: string,
  ) {
    if (!deviceToken)
      throw new UnauthorizedException('Dispositivo no autenticado');
    return await this.surveysService.getCatalogs(lastSyncDate);
  }
  /**
   * Proxy de catálogos servidos por una API externa (OrigenDatosTipo = 'API').
   * El backend agrega el token de esa API (nunca viaja al dispositivo) y
   * resuelve los catálogos dependientes ({padre}) antes de responder.
   */
  @Get('catalogos-api')
  async getCatalogosApi(@Headers('x-device-token') deviceToken: string) {
    if (!deviceToken)
      throw new UnauthorizedException('Dispositivo no autenticado');
    return { data: await this.catalogosExternosService.obtenerCatalogosApi() };
  }
  /**
   * El controlador expone el endpoint 1.7 sendSurvey para la recepción de datos.
   */
  @Post('submit')
  async submit(
    @Body() payload: any,
    @Headers('x-device-token') deviceToken: string,
    @Headers('x-user-id') headerUserId: string, // Cambiamos el nombre para no confundir
  ) {
    if (!deviceToken)
      throw new UnauthorizedException('Dispositivo no autenticado');

    // 1. EL FIX: Extraemos el ID del usuario desde el payload (Frontend) o desde el Header
    const finalUserId = payload.IdUsuario || headerUserId;

    // 2. Validación de seguridad
    if (!finalUserId || isNaN(Number(finalUserId))) {
      console.error('❌ Petición rechazada: No se encontró IdUsuario válido.', {
        payload,
        headerUserId,
      });
      throw new BadRequestException(
        'Falta el IdUsuario en el payload o es inválido',
      );
    }

    // 3. Ejecución del servicio (Ya enviamos un número real, nunca un NaN/NULL)
    return await this.surveysService.submitSurvey(Number(finalUserId), payload);
  }

  /**
   * Cambia el estado de una precarga (hoy solo RECHAZADO, desde "Cancelar Gestión").
   * El servicio valida la whitelist; aquí solo se exige dispositivo autenticado e
   * IdUsuario, igual que /submit.
   */
  @Post('precarga-estado')
  async precargaEstado(
    @Body() body: { idPrecarga?: string; estado?: string },
    @Headers('x-device-token') deviceToken: string,
    @Headers('x-user-id') headerUserId: string,
  ) {
    if (!deviceToken)
      throw new UnauthorizedException('Dispositivo no autenticado');
    const userId = Number(headerUserId);
    if (!body?.idPrecarga || isNaN(userId)) {
      throw new BadRequestException('Falta idPrecarga o IdUsuario válido');
    }
    return await this.surveysService.actualizarEstadoPrecarga(
      userId,
      body.idPrecarga,
      body.estado,
    );
  }
}
