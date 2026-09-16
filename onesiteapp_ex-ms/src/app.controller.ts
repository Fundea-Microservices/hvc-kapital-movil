import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
// `import type` es obligatorio para un tipo usado en la firma de un método decorado
// cuando están activos `isolatedModules` y `emitDecoratorMetadata`.
import type { InfoApi } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}
  @Get()
  obtenerInfo(): InfoApi {
    return this.appService.obtenerInfo();
  }
}
