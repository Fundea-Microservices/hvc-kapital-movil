import {
  Injectable,
  Logger,
  OnModuleInit,
  InternalServerErrorException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, ReadStream } from 'fs';
import { access, constants, mkdir, stat, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { isAbsolute, join, resolve, sep } from 'path';

import {
  ContextoArchivo,
  TipoMedio,
  construirNombreArchivo,
  construirRutaRelativa,
  esNombreSeguro,
  esRutaContenida,
  normalizarExtension,
  validarPeso,
  validarTipo,
} from '../domain/multimedia.politicas';

export interface ArchivoGuardado {
  rutaRelativa: string;
  nombreArchivo: string;
  extension: string;
  tamanioBytes: number;
  hashSha256: string;
}

/**
 * Único punto del backend que toca el sistema de archivos.
 *
 * Todas las DECISIONES (qué nombre, qué ruta, si se acepta) viven en
 * `domain/multimedia.politicas.ts`, que es puro y está probado. Aquí solo queda la
 * ejecución: crear directorios, escribir bytes y leerlos. Esa separación es lo que
 * permite tener la batería de path traversal bajo prueba sin disco.
 */
@Injectable()
export class MultimediaStorageService implements OnModuleInit {
  private readonly logger = new Logger(MultimediaStorageService.name);

  /** Raíz absoluta ya resuelta. Vacía mientras el módulo esté deshabilitado. */
  private raiz = '';

  /** Motivo por el que multimedia no está operativo, o null si todo está bien. */
  private motivoDeshabilitado: string | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Valida la configuración AL ARRANCAR, no en la primera subida.
   *
   * DEGRADA EN VEZ DE TUMBAR EL PROCESO. Si la raíz falta, no es absoluta o no es
   * escribible, se registra un error muy visible y **solo multimedia** queda fuera de
   * servicio: login, sincronización y `/submit` siguen funcionando. Multimedia es una
   * función nueva y no debe poder dejar sin operación a los asesores en campo, que es
   * lo que pasaría si el proceso no arrancara por una variable de entorno.
   *
   * Lo que NO se hace es inventar un valor por defecto —escribir en `./uploads`, por
   * ejemplo—: eso haría que todo "funcionara" mientras las fotos se acumulan en un
   * directorio efímero que el siguiente despliegue borra. Es la trampa que ya costó
   * cara con `RUTA_DATOS`. Aquí el fallo es visible en el log y en la respuesta HTTP,
   * pero acotado a su módulo.
   */
  async onModuleInit(): Promise<void> {
    const configurada = (
      this.config.get<string>('MULTIMEDIA_RUTA_RAIZ') || ''
    ).trim();

    if (configurada === '') {
      this.deshabilitar(
        'MULTIMEDIA_RUTA_RAIZ no está definida en el .env. No se asume ningún valor por ' +
          'defecto: un directorio improvisado se borraría en el siguiente despliegue.',
      );
      return;
    }

    if (!isAbsolute(configurada)) {
      this.deshabilitar(
        `MULTIMEDIA_RUTA_RAIZ debe ser una ruta ABSOLUTA (recibido: "${configurada}"). ` +
          'Una ruta relativa se resuelve contra el cwd del proceso, que bajo pm2 no es la ' +
          'raíz del proyecto — el mismo fallo que tuvo envFilePath.',
      );
      return;
    }

    const candidata = resolve(configurada);

    try {
      await mkdir(candidata, { recursive: true });
      await access(candidata, constants.W_OK);
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.deshabilitar(
        `MULTIMEDIA_RUTA_RAIZ no es escribible ("${candidata}"): ${detalle}`,
      );
      return;
    }

    this.raiz = candidata;
    this.motivoDeshabilitado = null;
    this.logger.log(`Storage de multimedia listo en: ${this.raiz}`);
  }

  /** Registra el motivo con la máxima visibilidad posible en el log de arranque. */
  private deshabilitar(motivo: string): void {
    this.motivoDeshabilitado = motivo;
    this.logger.error('='.repeat(78));
    this.logger.error(
      'MULTIMEDIA DESHABILITADO — el resto del backend sigue operativo.',
    );
    this.logger.error(motivo);
    this.logger.error(
      'Los adjuntos no se podrán subir y quedarán en cola en los dispositivos hasta ' +
        'que se corrija la variable y se reinicie el servicio. No se pierde nada.',
    );
    this.logger.error('='.repeat(78));
  }

  /** `true` si el storage está operativo. */
  estaDisponible(): boolean {
    return this.motivoDeshabilitado === null && this.raiz !== '';
  }

  /**
   * Lanza 503 si el módulo está deshabilitado.
   *
   * Se responde 503 y no 500 a propósito: para la cola del dispositivo es un error
   * REINTENTABLE, así que los archivos se quedan esperando y subirán solos en cuanto
   * el servidor se configure bien. Un 4xx los marcaría como rechazados y habría que
   * recuperarlos a mano.
   */
  private exigirDisponible(): void {
    if (this.estaDisponible()) return;
    this.logger.warn(
      `Petición de multimedia rechazada: ${this.motivoDeshabilitado}`,
    );
    throw new ServiceUnavailableException(
      'El almacenamiento de archivos no está configurado en el servidor. ' +
        'Los adjuntos permanecerán en cola en el dispositivo.',
    );
  }

  /** Peso máximo vigente, en KB. */
  pesoMaximoKb(): number {
    const valor = Number(this.config.get<string>('MULTIMEDIA_PESO_MAXIMO_KB'));
    return Number.isFinite(valor) && valor > 0 ? valor : 5120;
  }

  /**
   * Lista blanca de extensiones para un tipo de medio, leída del `.env`.
   * Se declara por tipo para poder ser estricto donde importa: una pregunta de FOTO
   * no tiene por qué aceptar un `.xlsx`.
   */
  extensionesPermitidas(tipo: TipoMedio): string[] {
    const porDefecto: Record<TipoMedio, string> = {
      FOTO: 'jpg,jpeg,png,heic,heif,webp',
      MULTIMEDIA: 'jpg,jpeg,png,heic,heif,webp,mp4,mov,3gp',
      DOCUMENTO: 'pdf,doc,docx,xls,xlsx,csv,txt',
      FIRMA: 'png,jpg,jpeg',
    };
    const crudo =
      this.config.get<string>(`MULTIMEDIA_EXTENSIONES_${tipo}`) ||
      porDefecto[tipo];
    return crudo
      .split(',')
      .map((e) => normalizarExtension(e))
      .filter((e) => e !== '');
  }

  /**
   * Escribe el binario y devuelve los metadatos a persistir.
   *
   * El orden importa: se valida TODO antes de tocar el disco. Por eso el controlador
   * usa `memoryStorage` — con `diskStorage`, multer escribe el archivo con un nombre
   * derivado del cliente *antes* de que este código llegue a opinar, que es la puerta
   * clásica del path traversal en subidas.
   */
  async guardar(
    contexto: ContextoArchivo,
    tipo: TipoMedio,
    buffer: Buffer,
    nombreOriginal: string | null,
    extensionSugerida: string,
  ): Promise<ArchivoGuardado> {
    this.exigirDisponible();

    const extension = normalizarExtension(extensionSugerida);

    const tipoOk = validarTipo(extension, this.extensionesPermitidas(tipo));
    if (!tipoOk.valido) throw new ForbiddenException(tipoOk.motivo);

    // Se mide el Buffer REAL, no el Content-Length que declaró el cliente.
    const pesoOk = validarPeso(buffer.length, this.pesoMaximoKb());
    if (!pesoOk.valido) throw new ForbiddenException(pesoOk.motivo);

    const nombreArchivo = construirNombreArchivo(contexto, extension);

    // Aserción defensiva. El nombre lo genera el dominio a partir de enteros del
    // servidor, así que esto no debería fallar nunca; si algún día alguien introduce
    // un componente de origen externo, esta línea lo detiene antes del disco.
    if (!esNombreSeguro(nombreArchivo)) {
      this.logger.error(
        `Nombre generado no seguro, se aborta: "${nombreArchivo}"`,
      );
      throw new InternalServerErrorException(
        'No se pudo determinar un nombre de archivo seguro',
      );
    }

    const rutaRelativa = construirRutaRelativa(contexto, extension, '/');
    const rutaAbsoluta = this.resolverAbsoluta(rutaRelativa);

    try {
      await mkdir(join(rutaAbsoluta, '..'), { recursive: true });
      await writeFile(rutaAbsoluta, buffer);
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.logger.error(`No se pudo escribir "${rutaRelativa}": ${detalle}`);
      throw new InternalServerErrorException('No se pudo almacenar el archivo');
    }

    const hashSha256 = createHash('sha256').update(buffer).digest('hex');
    this.logger.log(
      `Archivo guardado: ${rutaRelativa} (${buffer.length} bytes)`,
    );

    return {
      rutaRelativa,
      nombreArchivo,
      extension,
      tamanioBytes: buffer.length,
      hashSha256,
    };
  }

  /**
   * Abre un archivo ya almacenado para servirlo.
   *
   * La comprobación de contención se repite EN LECTURA, no solo en escritura. La ruta
   * llega desde la base de datos, que es una fuente de confianza razonable pero no
   * absoluta: si una fila fuera manipulada o quedara mal escrita por una migración,
   * este endpoint se convertiría en un lector arbitrario del sistema de archivos.
   */
  async abrir(
    rutaRelativa: string,
  ): Promise<{ stream: ReadStream; tamanioBytes: number }> {
    this.exigirDisponible();

    const rutaAbsoluta = this.resolverAbsoluta(rutaRelativa);

    let tamanioBytes = 0;
    try {
      const info = await stat(rutaAbsoluta);
      if (!info.isFile()) throw new Error('La ruta no apunta a un archivo');
      tamanioBytes = info.size;
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Archivo no disponible "${rutaRelativa}": ${detalle}`);
      throw new InternalServerErrorException('El archivo no está disponible');
    }

    return { stream: createReadStream(rutaAbsoluta), tamanioBytes };
  }

  /**
   * Convierte una ruta relativa en absoluta y verifica que caiga dentro de la raíz.
   *
   * `resolve` colapsa los `..`, y `esRutaContenida` comprueba el resultado exigiendo
   * separador tras la raíz — sin eso, con raíz `/datos` la ruta `/datos-viejos/x`
   * pasaría por buena siendo otro directorio.
   */
  private resolverAbsoluta(rutaRelativa: string): string {
    const absoluta = resolve(this.raiz, rutaRelativa);

    if (!esRutaContenida(absoluta, this.raiz, sep)) {
      this.logger.error(
        `Intento de acceso fuera de la raíz: "${rutaRelativa}" -> "${absoluta}"`,
      );
      throw new ForbiddenException('Ruta de archivo no permitida');
    }

    return absoluta;
  }
}
