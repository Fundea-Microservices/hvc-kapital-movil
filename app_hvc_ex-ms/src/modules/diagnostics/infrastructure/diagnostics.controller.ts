import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import {
  DiagnosticsService,
  type ResultadoRecepcion,
} from '../application/diagnostics.service';

/** Cuerpo esperado. Se tipa explícitamente en vez de aceptar `any`. */
interface CuerpoBitacora {
  errores?: unknown;
}

@Controller('api/v1/diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  /**
   * Recibe la bitácora de errores acumulada en un dispositivo.
   *
   * SIEMPRE responde 200, incluso si descarta entradas. La razón es operativa: un
   * error aquí haría que el dispositivo reintentara el mismo lote en cada
   * sincronización, gastando datos del asesor por algo que no afecta a su trabajo. El
   * conteo de descartadas viaja en la respuesta para que se pueda observar sin
   * penalizar al cliente.
   *
   * Se exige `x-device-token` —igual que el resto de la API— para que la tabla no
   * quede abierta a cualquiera. El usuario es opcional: un error puede ocurrir antes
   * de que alguien inicie sesión, y ese caso es justo de los que interesa registrar.
   */
  @Post('errors')
  async recibirErrores(
    @Body() cuerpo: CuerpoBitacora,
    @Headers('x-device-token') deviceToken: string,
    @Headers('x-user-id') userId: string,
  ): Promise<{ success: true } & ResultadoRecepcion> {
    if (!deviceToken)
      throw new UnauthorizedException('Dispositivo no autenticado');

    const idUsuario = Number(userId);
    const resultado = await this.diagnosticsService.registrarLote(
      cuerpo?.errores,
      deviceToken,
      Number.isFinite(idUsuario) && idUsuario > 0 ? idUsuario : null,
    );

    return { success: true, ...resultado };
  }
}
