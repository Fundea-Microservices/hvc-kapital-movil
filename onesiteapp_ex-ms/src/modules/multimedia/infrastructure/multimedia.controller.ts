import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';
import type { Response } from 'express';

import { MultimediaService, PeticionSubida, RespuestaSubida } from '../application/multimedia.service';
import { MultimediaStorageService } from '../application/multimedia-storage.service';
import { TipoMedio } from '../domain/multimedia.politicas';

const TIPOS_VALIDOS: readonly TipoMedio[] = ['FOTO', 'MULTIMEDIA', 'DOCUMENTO', 'FIRMA'];

/** Contrato de respuesta del endpoint de subida. */
interface RespuestaEndpoint extends RespuestaSubida {
  success: true;
}

/**
 * Cuerpo de la subida. Llega como `multipart/form-data`, así que TODOS los campos son
 * strings: el navegador y `FormData` de React Native no transportan tipos. Se declara
 * explícitamente en vez de tipar como `any` y se convierte con validación.
 */
interface CamposSubida {
  idCaptura?: string;
  idPregunta?: string;
  tipoMedio?: string;
  claveInstancia?: string;
  secuencia?: string;
  nombreOriginal?: string;
  extension?: string;
  fechaCaptura?: string;
  dispositivoId?: string;
}

@Controller('api/v1/multimedia')
export class MultimediaController {
  constructor(
    private readonly multimediaService: MultimediaService,
    private readonly storage: MultimediaStorageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Recibe un archivo.
   *
   * `memoryStorage` es una decisión de seguridad, no de rendimiento: con `diskStorage`
   * multer escribe el archivo —con un nombre derivado de lo que mandó el cliente—
   * ANTES de que ningún código propio pueda validarlo. En memoria, el byte no toca el
   * disco hasta que el storage decide dónde y cómo, con un nombre que genera el
   * servidor. El coste es tener el archivo en RAM; por eso `limits.fileSize` corta la
   * ingesta en el límite configurado en lugar de leerlo entero y rechazarlo después.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: memoryStorage(),
      limits: {
        // 5 MB por defecto; el servicio revalida contra el parámetro real.
        fileSize: Number(process.env.MULTIMEDIA_PESO_MAXIMO_KB || 5120) * 1024,
        files: 1,
      },
    }),
  )
  async subir(
    @UploadedFile() archivo: Express.Multer.File | undefined,
    // Multer deja los campos de texto del multipart en el body, ya parseados. Se
    // tipan explícitamente como strings —que es lo único que transporta un
    // `FormData`— en vez de aceptar un `any` y confiar en la conversión implícita.
    @Body() campos: CamposSubida,
    @Headers('x-device-token') deviceToken: string,
    @Headers('x-user-id') userId: string,
  ): Promise<RespuestaEndpoint> {
    if (!deviceToken) throw new UnauthorizedException('Dispositivo no autenticado');
    if (!archivo) throw new BadRequestException('No se recibió ningún archivo');

    const idUsuario = Number(userId);
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
      throw new UnauthorizedException('Usuario no identificado');
    }

    const peticion = this.construirPeticion(campos ?? {}, archivo);
    const resultado = await this.multimediaService.subir(peticion, archivo.buffer, idUsuario);

    return { success: true, ...resultado };
  }

  /**
   * Sirve un archivo almacenado.
   *
   * La raíz del storage vive FUERA del árbol servido y no se monta `ServeStaticModule`:
   * el único acceso es este endpoint, que exige token y resuelve id→ruta contra la base
   * de datos. `Content-Disposition: attachment` más `nosniff` evitan que un archivo
   * subido se interprete como HTML en el navegador del BackOffice, que sería un XSS
   * almacenado con la sesión del administrador.
   */
  @Get(':id')
  async descargar(
    @Param('id') id: string,
    @Headers('x-device-token') deviceToken: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!deviceToken) throw new UnauthorizedException('Dispositivo no autenticado');

    const fila = await this.multimediaService.obtenerParaDescarga(id);
    const { stream, tamanioBytes } = await this.storage.abrir(fila.RutaRelativa);

    res.set({
      'Content-Type': fila.MimeType || 'application/octet-stream',
      'Content-Length': String(tamanioBytes),
      'Content-Disposition': `attachment; filename="${fila.NombreArchivo}"`,
      'X-Content-Type-Options': 'nosniff',
    });

    return new StreamableFile(stream);
  }

  /** Convierte y valida los campos de texto del multipart. */
  private construirPeticion(
    campos: CamposSubida,
    archivo: Express.Multer.File,
  ): PeticionSubida {
    const idCaptura = (campos.idCaptura || '').trim();
    // Se valida como CADENA de dígitos, sin pasar por Number: es un BIGINT y
    // convertirlo lo redondearía silenciosamente por encima del entero seguro.
    if (!/^\d{1,19}$/.test(idCaptura)) {
      throw new BadRequestException('idCaptura ausente o inválido');
    }

    const idPregunta = Number(campos.idPregunta);
    if (!Number.isInteger(idPregunta) || idPregunta <= 0) {
      throw new BadRequestException('idPregunta ausente o inválido');
    }

    const tipoMedio = (campos.tipoMedio || '').trim().toUpperCase() as TipoMedio;
    if (!TIPOS_VALIDOS.includes(tipoMedio)) {
      throw new BadRequestException(`tipoMedio inválido: "${campos.tipoMedio}"`);
    }

    const secuencia = Number(campos.secuencia || 1);

    return {
      idCaptura,
      idPregunta,
      tipoMedio,
      claveInstancia: (campos.claveInstancia || '').trim(),
      secuencia: Number.isInteger(secuencia) && secuencia > 0 ? secuencia : 1,
      // El nombre original se guarda como dato informativo; nunca forma parte de una ruta.
      nombreOriginal: campos.nombreOriginal || archivo.originalname || null,
      extension: campos.extension || '',
      // El MIME que declara el cliente es orientativo: la decisión de aceptar o no se
      // toma sobre la extensión contra la lista blanca del servidor.
      mimeType: archivo.mimetype || null,
      fechaCaptura: campos.fechaCaptura || null,
      dispositivoId: campos.dispositivoId || null,
    };
  }
}
