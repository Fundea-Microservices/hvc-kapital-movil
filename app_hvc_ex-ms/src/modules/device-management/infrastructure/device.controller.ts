import {
  Controller,
  Post,
  Put,
  Body,
  UsePipes,
  Patch,
  Get,
  Param,
  Query,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceService } from '../application/device.service';
import {
  type EnrollDeviceDto,
  EnrollDeviceSchema,
} from '../domain/dtos/enroll-device.dto';
import * as updateMetadataDto from '../domain/dtos/update-metadata.dto';
import { ZodValidationPipe } from '../../../core/pipes/zod-validation.pipe';

@Controller('api/v1/devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}
  @Post('enroll')
  @UsePipes(new ZodValidationPipe(EnrollDeviceSchema))
  async enrollDevice(@Body() body: EnrollDeviceDto) {
    return await this.deviceService.enrolarEquipo(body);
  }
  // Nuevo Endpoint PUT para los Metadatos
  @Put('metadata')
  async updateMetadata(@Body() body: updateMetadataDto.UpdateMetadataDto) {
    // Validamos el payload con Zod
    const validData = updateMetadataDto.UpdateMetadataSchema.parse(body);
    return await this.deviceService.actualizarInfo(validData);
  }
  // ... (métodos POST enroll y PUT metadata)
  // SPRINT 4: Botón de Pánico desde el BackOffice
  @Patch('block/:token')
  async blockDevice(@Param('token') token: string) {
    return await this.deviceService.darDeBaja(token);
  }

  // SPRINT 13: Desvinculación self-service (Login o Dashboard). NO autenticada: se
  // autoriza con el device token del equipo enrolado (lo inyecta el interceptor).
  @Post('unenroll')
  async unenrollDevice(@Headers('x-device-token') deviceToken: string) {
    if (!deviceToken) {
      throw new UnauthorizedException('DeviceToken es requerido');
    }
    return await this.deviceService.desvincular(deviceToken);
  }
  // SPRINT 4: Validación de versión de la App
  // Validación de versión de la App (Middleware/Guard opcional en el futuro)
  @Get('version')
  async checkVersion(@Query('appVersion') appVersion: string) {
    return await this.deviceService.verificarVersion(appVersion);
  }
}
// Usamos un Pipe personalizado o validación manual para Zod
// async enrollDevice(@Body() body: EnrollDeviceDto) {
// Validar esquema con Zod antes de procesar
//   const validData = EnrollDeviceSchema.parse(body);
//   return await this.deviceService.enrolarEquipo(validData);
// } }
