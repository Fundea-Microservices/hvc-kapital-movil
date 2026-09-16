import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Prefijo que comparten todas las rutas del microservicio. *
 */
export const PREFIJO_API = 'api/v1';

/** Zona horaria para la hora legible. El `ecosystem.config.js` fija `TZ=UTC` en
 *  producción, así que sin una zona explícita la hora "local" saldría en UTC. */
const ZONA_HORARIA_POR_DEFECTO = 'America/Guatemala';

export interface InfoApi {
  nombre: string;
  version: string;
  prefijo: string;
  horaActual: string;
  horaActualLocal: string;
  zonaHoraria: string;
  ultimaActualizacion: string;
}


@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  /** Se resuelven una sola vez al arrancar: no cambian durante la vida del proceso
   *  y no tiene sentido tocar el disco en cada petición al endpoint raíz. */
  private readonly version = '1.0.0';
  private readonly ultimaActualizacion = '26-08-2026';
  private readonly zonaHoraria =
    (process.env.API_ZONA_HORARIA || '').trim() || ZONA_HORARIA_POR_DEFECTO;

  constructor() {   
  }

  obtenerInfo(): InfoApi {
    const ahora = new Date();

    return {
      nombre: 'API OneSite EX FUNDEA',
      version: this.version,
      prefijo: PREFIJO_API,
      horaActual: ahora.toISOString(),
      horaActualLocal: this.formatearLocal(ahora),
      zonaHoraria: this.zonaHoraria,
      ultimaActualizacion: this.ultimaActualizacion,
    };
  }

  private formatearLocal(fecha: Date): string {
    try {
      return new Intl.DateTimeFormat('es-GT', {
        dateStyle: 'full',
        timeStyle: 'medium',
        timeZone: this.zonaHoraria,
      }).format(fecha);
    } catch {
      this.logger.warn(
        `Zona horaria no válida: "${this.zonaHoraria}". Se informa la hora en UTC.`,
      );
      return fecha.toUTCString();
    }
  }
}
