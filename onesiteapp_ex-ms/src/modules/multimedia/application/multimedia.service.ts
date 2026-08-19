import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { MultimediaStorageService } from './multimedia-storage.service';
import { ContextoArchivo, TipoMedio } from '../domain/multimedia.politicas';

/** Lo que el dispositivo declara al subir un archivo. */
export interface PeticionSubida {
  /** BIGINT como string: convertirlo a number lo redondearía sin error. */
  idCaptura: string;
  idPregunta: number;
  tipoMedio: TipoMedio;
  claveInstancia?: string | null;
  secuencia?: number;
  nombreOriginal?: string | null;
  extension: string;
  mimeType?: string | null;
  fechaCaptura?: string | null;
  dispositivoId?: string | null;
}

export interface RespuestaSubida {
  idMultimedia: string;
  nombreArchivo: string;
  rutaRelativa: string;
  tamanioBytes: number;
  /** `true` cuando el archivo ya estaba: el reintento se resuelve solo. */
  yaExistia: boolean;
}

interface FilaMultimedia {
  IdMultimedia: string | number;
  RutaRelativa: string;
  NombreArchivo: string;
  NombreOriginal: string | null;
  MimeType: string | null;
  TamanioBytes: string | number;
}

interface FilaCaptura {
  IdCaptura: string | number;
  IdEncuesta: number;
  IdUsuario: number | null;
}

/**
 * Orquesta la subida: valida la propiedad de la captura, delega el disco al storage y
 * registra la fila. No toca `fs` ni construye nombres — eso es del storage y del
 * dominio respectivamente.
 */
@Injectable()
export class MultimediaService {
  private readonly logger = new Logger(MultimediaService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: MultimediaStorageService,
  ) {}

  /**
   * Comprueba que la captura exista y PERTENEZCA al usuario autenticado.
   *
   * Sin esta verificación, cualquier dispositivo enrolado podría adjuntar archivos a
   * las capturas de cualquier otro asesor simplemente iterando `IdCaptura`, que es un
   * entero consecutivo — un IDOR de manual, y el control que más se olvida en un
   * endpoint de subida porque el token de dispositivo *parece* suficiente.
   *
   * Devuelve además el `IdEncuesta` REAL leído de la base: el nombre del archivo se
   * construye con él y no con lo que declare el cliente.
   */
  private async verificarPropiedad(
    idCaptura: string,
    idUsuario: number,
  ): Promise<FilaCaptura> {
    const filas: FilaCaptura[] = await this.dataSource.query(
      'SELECT IdCaptura, IdEncuesta, IdUsuario FROM appEx_Encabezado_Captura WHERE IdCaptura = @0',
      [idCaptura],
    );

    const captura = filas?.[0];
    if (!captura) throw new NotFoundException('La captura indicada no existe');

    if (Number(captura.IdUsuario) !== Number(idUsuario)) {
      this.logger.warn(
        `IDOR bloqueado: el usuario ${idUsuario} intentó adjuntar a la captura ${idCaptura}, ` +
          `que pertenece al usuario ${captura.IdUsuario}.`,
      );
      throw new ForbiddenException(
        'La captura no pertenece al usuario autenticado',
      );
    }

    return captura;
  }

  /**
   * Busca una fila ya registrada para la misma coordenada lógica.
   *
   * Es la mitad amable de la idempotencia: si el archivo llegó pero el dispositivo
   * perdió el ACK (lo más habitual con mala señal), reintentará. Responder 200 con
   * `yaExistia: true` cierra ese caso sin intervención, en vez de devolver un 409 a
   * ciegas que el móvil no sabría interpretar. La garantía DURA sigue siendo el índice
   * único de la tabla, que sobrevive a reinstalaciones y a sincronizaciones solapadas.
   */
  private async buscarExistente(
    contexto: ContextoArchivo,
  ): Promise<FilaMultimedia | null> {
    const filas: FilaMultimedia[] = await this.dataSource.query(
      `SELECT TOP 1 IdMultimedia, RutaRelativa, NombreArchivo, NombreOriginal, MimeType, TamanioBytes
         FROM appEx_Multimedia
        WHERE IdCaptura = @0 AND IdPregunta = @1 AND ClaveInstancia = @2 AND Secuencia = @3
          AND Estado = 1`,
      [
        contexto.idCaptura,
        contexto.idPregunta,
        contexto.claveInstancia ?? '',
        contexto.secuencia ?? 1,
      ],
    );
    return filas?.[0] ?? null;
  }

  async subir(
    peticion: PeticionSubida,
    buffer: Buffer,
    idUsuario: number,
  ): Promise<RespuestaSubida> {
    const captura = await this.verificarPropiedad(
      peticion.idCaptura,
      idUsuario,
    );

    const contexto: ContextoArchivo = {
      // IdEncuesta sale de la BD, NO del cliente: el nombre del archivo se construye
      // exclusivamente con datos que controla el servidor.
      idEncuesta: Number(captura.IdEncuesta),
      idCaptura: String(peticion.idCaptura),
      idPregunta: Number(peticion.idPregunta),
      claveInstancia: peticion.claveInstancia ?? '',
      secuencia: peticion.secuencia ?? 1,
    };

    const existente = await this.buscarExistente(contexto);
    if (existente && Number(existente.TamanioBytes) === buffer.length) {
      this.logger.log(
        `Subida idempotente: ${existente.NombreArchivo} ya existía con el mismo tamaño.`,
      );
      return {
        idMultimedia: String(existente.IdMultimedia),
        nombreArchivo: existente.NombreArchivo,
        rutaRelativa: existente.RutaRelativa,
        tamanioBytes: Number(existente.TamanioBytes),
        yaExistia: true,
      };
    }

    const guardado = await this.storage.guardar(
      contexto,
      peticion.tipoMedio,
      buffer,
      peticion.nombreOriginal ?? null,
      peticion.extension,
    );

    // Si la fila existía pero con OTRO tamaño, el asesor retomó la foto: se actualiza
    // en vez de insertar, porque el índice único lo impediría y porque conceptualmente
    // es el mismo adjunto. El archivo anterior queda huérfano en disco a propósito —
    // borrarlo aquí destruiría evidencia si la escritura nueva fallara a medias; el
    // barrido periódico se encarga.
    if (existente) {
      await this.dataSource.query(
        `UPDATE appEx_Multimedia
            SET RutaRelativa = @0, NombreArchivo = @1, NombreOriginal = @2, Extension = @3,
                MimeType = @4, TamanioBytes = @5, HashSha256 = @6, FechaSubida = GETDATE()
          WHERE IdMultimedia = @7`,
        [
          guardado.rutaRelativa,
          guardado.nombreArchivo,
          peticion.nombreOriginal ?? null,
          guardado.extension,
          peticion.mimeType ?? null,
          guardado.tamanioBytes,
          guardado.hashSha256,
          existente.IdMultimedia,
        ],
      );

      return {
        idMultimedia: String(existente.IdMultimedia),
        nombreArchivo: guardado.nombreArchivo,
        rutaRelativa: guardado.rutaRelativa,
        tamanioBytes: guardado.tamanioBytes,
        yaExistia: false,
      };
    }

    const insertado: Array<{ IdMultimedia: string | number }> =
      await this.dataSource.query(
        `INSERT INTO appEx_Multimedia
         (IdCaptura, IdEncuesta, IdPregunta, ClaveInstancia, Secuencia, TipoMedio,
          RutaRelativa, NombreArchivo, NombreOriginal, Extension, MimeType,
          TamanioBytes, HashSha256, IdUsuario, DispositivoID, FechaCaptura)
       OUTPUT inserted.IdMultimedia
       VALUES (@0, @1, @2, @3, @4, @5, @6, @7, @8, @9, @10, @11, @12, @13, @14, @15)`,
        [
          contexto.idCaptura,
          contexto.idEncuesta,
          contexto.idPregunta,
          contexto.claveInstancia ?? '',
          contexto.secuencia ?? 1,
          peticion.tipoMedio,
          guardado.rutaRelativa,
          guardado.nombreArchivo,
          peticion.nombreOriginal ?? null,
          guardado.extension,
          peticion.mimeType ?? null,
          guardado.tamanioBytes,
          guardado.hashSha256,
          idUsuario,
          peticion.dispositivoId ?? null,
          peticion.fechaCaptura ?? null,
        ],
      );

    return {
      idMultimedia: String(insertado?.[0]?.IdMultimedia ?? ''),
      nombreArchivo: guardado.nombreArchivo,
      rutaRelativa: guardado.rutaRelativa,
      tamanioBytes: guardado.tamanioBytes,
      yaExistia: false,
    };
  }

  /** Resuelve id → fila para servir el binario por un endpoint autenticado. */
  async obtenerParaDescarga(idMultimedia: string): Promise<FilaMultimedia> {
    const filas: FilaMultimedia[] = await this.dataSource.query(
      `SELECT TOP 1 IdMultimedia, RutaRelativa, NombreArchivo, NombreOriginal, MimeType, TamanioBytes
         FROM appEx_Multimedia WHERE IdMultimedia = @0 AND Estado = 1`,
      [idMultimedia],
    );

    const fila = filas?.[0];
    if (!fila) throw new NotFoundException('Archivo no encontrado');
    return fila;
  }
}
