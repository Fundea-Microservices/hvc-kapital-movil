import { Controller, Post, Put, Body, UsePipes } from '@nestjs/common';
import { DeviceService } from '../application/device.service';
import { type EnrollDeviceDto, EnrollDeviceSchema } from '../domain/dtos/enroll-device.dto';
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



}
  // Usamos un Pipe personalizado o validación manual para Zod
 // async enrollDevice(@Body() body: EnrollDeviceDto) {
    // Validar esquema con Zod antes de procesar
 //   const validData = EnrollDeviceSchema.parse(body);
    
 //   return await this.deviceService.enrolarEquipo(validData);
 // } }