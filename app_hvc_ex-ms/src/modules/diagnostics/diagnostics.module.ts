import { Module } from '@nestjs/common';

import { DiagnosticsService } from './application/diagnostics.service';
import { DiagnosticsController } from './infrastructure/diagnostics.controller';

/**
 * Bitácora de errores de la aplicación móvil.
 *
 * Mismo corte hexagonal que el resto del proyecto:
 *   infrastructure/ → el controlador HTTP
 *   application/    → inserción en la base
 *   domain/         → las políticas de validación, puras y probadas
 */
@Module({
  providers: [DiagnosticsService],
  controllers: [DiagnosticsController],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
