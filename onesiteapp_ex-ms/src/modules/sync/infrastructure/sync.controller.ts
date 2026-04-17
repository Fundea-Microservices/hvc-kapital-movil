import { Controller, Post, Get, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { SyncService } from '../application/sync.service';
import * as syncDeltasDto from '../domain/dtos/sync-deltas.dto';

@Controller('api/v1/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  // Flujo 3: TraerDeltas
  @Post('deltas')
  async getDeltas(
    @Body() body: syncDeltasDto.SyncDeltasDto, 
    @Headers('x-device-token') deviceToken: string
  ) {
    if (!deviceToken) throw new UnauthorizedException('DeviceToken es requerido');
    
    const validData = syncDeltasDto.SyncDeltasSchema.parse(body);
    return await this.syncService.obtenerDeltas(validData.lastSyncDates, deviceToken);
  }

  // Flujo 3: ObtenerParametros
  @Get('parametros')
  async getParametros(@Headers('authorization') authHeader: string) {
    // Aquí podemos usar la misma validación JWT que en AuthController si se desea
    return await this.syncService.obtenerParametros();
  }

  // Método 3.1: ConfirmarSinc (ACK)
  @Post('ack')
  async acknowledgeSync(
    @Body() body: syncDeltasDto.AckSyncDto,
    @Headers('x-device-token') deviceToken: string
  ) {
    if (!deviceToken) throw new UnauthorizedException('DeviceToken es requerido');
    
    const validData = syncDeltasDto.AckSyncSchema.parse(body);
    return await this.syncService.confirmarSincronizacion(validData, deviceToken);
  }
}