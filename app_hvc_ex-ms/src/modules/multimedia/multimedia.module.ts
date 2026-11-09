import { Module } from '@nestjs/common';

import { MultimediaService } from './application/multimedia.service';
import { MultimediaStorageService } from './application/multimedia-storage.service';
import { MultimediaController } from './infrastructure/multimedia.controller';

/**
 * Módulo de archivos adjuntos. Sigue el corte hexagonal del proyecto:
 *
 *   infrastructure/  → el controlador HTTP (multer, headers, códigos de estado)
 *   application/     → orquestación: propiedad de la captura, idempotencia, BD, disco
 *   domain/          → políticas puras y probadas: nombres, rutas, listas blancas
 *
 * `MultimediaStorageService` se exporta porque el controlador lo usa directamente
 * para abrir el stream de descarga sin que el servicio de aplicación tenga que
 * envolver un `ReadStream` que no le aporta nada.
 */
@Module({
  providers: [MultimediaService, MultimediaStorageService],
  controllers: [MultimediaController],
  exports: [MultimediaService, MultimediaStorageService],
})
export class MultimediaModule {}
