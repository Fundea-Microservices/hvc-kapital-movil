import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { normalizarLote, type EntradaNormalizada } from '../domain/bitacora.politicas';

export interface ResultadoRecepcion {
  recibidas: number;
  guardadas: number;
  descartadas: number;
}

/**
 * Recibe la bitácora de errores que acumulan los dispositivos.
 *
 * Toda la validación vive en `domain/bitacora.politicas.ts`, que es puro y está
 * probado; aquí solo queda insertar.
 */
@Injectable()
export class DiagnosticsService {
  private readonly logger = new Logger(DiagnosticsService.name);

  constructor(private readonly dataSource: DataSource) {}

  async registrarLote(
    cuerpo: unknown,
    dispositivoId: string | null,
    idUsuario: number | null,
  ): Promise<ResultadoRecepcion> {
    const recibidas = Array.isArray(cuerpo) ? cuerpo.length : 0;
    const entradas = normalizarLote(cuerpo);

    for (const entrada of entradas) {
      await this.insertar(entrada, dispositivoId, idUsuario);
    }

    const resultado: ResultadoRecepcion = {
      recibidas,
      guardadas: entradas.length,
      descartadas: recibidas - entradas.length,
    };

    if (entradas.length > 0) {
      this.logger.log(
        `Bitácora recibida de ${dispositivoId ?? 'dispositivo desconocido'}: ` +
        `${resultado.guardadas} guardadas, ${resultado.descartadas} descartadas.`,
      );
    }

    return resultado;
  }

  /**
   * Inserta una entrada. Los fallos se registran y NO se propagan.
   *
   * Es deliberado: la bitácora es diagnóstico, y devolver un error al dispositivo
   * haría que reintentara el mismo lote en cada ciclo, gastando datos del asesor por
   * algo que no afecta a su trabajo. Se prefiere perder una entrada de diagnóstico
   * antes que entorpecer la sincronización real.
   */
  private async insertar(
    entrada: EntradaNormalizada,
    dispositivoId: string | null,
    idUsuario: number | null,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO appEx_BitacoraErrores
           (Nivel, Origen, Mensaje, Detalle, ContextoJson, VersionApp, Plataforma,
            IdUsuario, DispositivoID, FechaError)
         VALUES (@0, @1, @2, @3, @4, @5, @6, @7, @8, COALESCE(@9, GETDATE()))`,
        [
          entrada.nivel,
          entrada.origen,
          entrada.mensaje,
          entrada.detalle,
          entrada.contextoJson,
          entrada.versionApp,
          entrada.plataforma,
          idUsuario,
          dispositivoId,
          // `null` cuando el reloj del dispositivo no era creíble: el COALESCE deja
          // la hora del servidor, que es aproximada pero no desordena la bitácora.
          entrada.fechaError,
        ],
      );
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo guardar una entrada de bitácora: ${detalle}`);
    }
  }
}
