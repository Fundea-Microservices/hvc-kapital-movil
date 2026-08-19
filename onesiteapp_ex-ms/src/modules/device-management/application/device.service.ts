import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EnrollDeviceDto } from '../domain/dtos/enroll-device.dto';
import { UpdateMetadataDto } from '../domain/dtos/update-metadata.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class DeviceService {
  constructor(private readonly dataSource: DataSource) {}

  // 1. Método Modificado: enrolarEquipo (POST)
  async enrolarEquipo(dto: EnrollDeviceDto) {
    const { codigoEnrolamiento, hardwareId } = dto;

    // Obtenemos NombreEmpresa además del ID y Estado
    const empresa = await this.dataSource.query(
      `SELECT IdEmpresa, NombreEmpresa, Estado FROM Empresas_AppEX WHERE CodigoEnrolamiento = @0`,
      [codigoEnrolamiento],
    );

    if (!empresa.length || !empresa[0].Estado) {
      throw new UnauthorizedException('Código de empresa inválido o inactivo');
    }

    const companyName = empresa[0].NombreEmpresa;

    const dispositivoExistente = await this.dataSource.query(
      `SELECT IdDispositivo, Estado, DeviceToken FROM Dispositivos_AppEX WHERE HardwareID = @0`,
      [hardwareId],
    );

    if (dispositivoExistente.length > 0) {
      if (!dispositivoExistente[0].Estado) {
        throw new UnauthorizedException(
          'Dispositivo bloqueado (Device Blocked)',
        );
      }

      // Re-vinculación de equipos legacy: los enrolados antes del Sprint 7 quedaron
      // sin IdEmpresa; al volver a enrolar se les asigna la empresa del código usado.
      await this.dataSource.query(
        `UPDATE Dispositivos_AppEX SET IdEmpresa = @1, FechaModificacion = GETDATE()
         WHERE IdDispositivo = @0 AND IdEmpresa IS NULL`,
        [dispositivoExistente[0].IdDispositivo, empresa[0].IdEmpresa],
      );

      return {
        message: 'Equipo ya enrolado',
        deviceToken: dispositivoExistente[0].DeviceToken,
        companyName: companyName, // Añadido a la respuesta
      };
    }

    const newDeviceToken = randomUUID();

    // El dispositivo queda VINCULADO a la empresa cuyo código se usó (Anexo 1: Dispositivos.IdEmpresa FK).
    await this.dataSource.query(
      `INSERT INTO Dispositivos_AppEX (HardwareID, DeviceToken, IdEmpresa, Estado, FechaIngreso, FechaModificacion)
       VALUES (@0, @1, @2, 1, GETDATE(), GETDATE())`,
      [hardwareId, newDeviceToken, empresa[0].IdEmpresa],
    );

    return {
      message: 'Equipo enrolado exitosamente',
      deviceToken: newDeviceToken,
      companyName: companyName, // Añadido a la respuesta
    };
  }

  // 2. Nuevo Método: actualizarInfo (PUT) - Método 1.4 del Sprint 1
  async actualizarInfo(dto: UpdateMetadataDto) {
    const { deviceToken, modelo, versionSO } = dto;

    // Verificamos que el dispositivo exista y esté activo
    const dispositivo = await this.dataSource.query(
      `SELECT IdDispositivo, Estado FROM Dispositivos_AppEX WHERE DeviceToken = @0`,
      [deviceToken],
    );

    if (!dispositivo.length) {
      throw new NotFoundException('Dispositivo no encontrado');
    }

    if (!dispositivo[0].Estado) {
      throw new UnauthorizedException('Dispositivo bloqueado (Device Blocked)');
    }

    // Actualizamos los metadatos. El Trigger actualizará Control_Versiones automáticamente.
    await this.dataSource.query(
      `UPDATE Dispositivos_AppEX 
       SET Modelo = @0, VersionSO = @1, FechaModificacion = GETDATE()
       WHERE DeviceToken = @2`,
      [modelo, versionSO, deviceToken],
    );

    return {
      message: 'Metadatos actualizados correctamente',
    };
  }

  // SPRINT 4: Método 4.1 - DarDeBaja (PATCH)
  // Este método será consumido por el BackOffice Web (Botón de Pánico)
  async darDeBaja(deviceToken: string) {
    // 1. Verificamos que el dispositivo exista
    const dispositivo = await this.dataSource.query(
      `SELECT IdDispositivo FROM Dispositivos WHERE DeviceToken = @0`,
      [deviceToken],
    );

    if (!dispositivo.length) {
      throw new NotFoundException('Dispositivo no encontrado');
    }

    // 2. Bloqueo administrativo (Estado = 0)
    // El Trigger de SQL Server actualizará Control_Versiones automáticamente
    await this.dataSource.query(
      `UPDATE Dispositivos 
       SET Estado = 0, FechaModificacion = GETDATE() 
       WHERE DeviceToken = @0`,
      [deviceToken],
    );

    // 3. Regla Crítica 4.5: Bloqueo de hardware superior a sesión
    // Por seguridad extrema, también invalidamos cualquier sesión activa de este equipo
    await this.dataSource.query(
      `UPDATE Sesiones 
       SET Activa = 0 
       WHERE IdDispositivo = @0`,
      [dispositivo[0].IdDispositivo],
    );

    return {
      message:
        'Dispositivo bloqueado exitosamente. Se ejecutará Wipe en su próxima petición.',
    };
  }

  // SPRINT 4: Método 4.1 - VerificarVersion (GET)
  async verificarVersion(appVersion: string) {
    // La versión mínima es PARAMETRIZABLE desde el BackOffice (Cat_Parametros_AppEx,
    // clave VERSION_MINIMA_APP). Si la clave no existe, se usa el fallback y toda
    // versión es aceptada — mismo comportamiento previo, nada se rompe.
    let versionMinimaRequerida = '1.0.0';
    try {
      const filas = await this.dataSource.query(
        `SELECT Valor FROM Cat_Parametros_AppEx WHERE Clave = 'VERSION_MINIMA_APP'`,
      );
      if (
        filas.length &&
        filas[0].Valor &&
        String(filas[0].Valor).trim() !== ''
      ) {
        versionMinimaRequerida = String(filas[0].Valor).trim();
      }
    } catch (e) {
      // La tabla puede no existir en ambientes antiguos; se conserva el fallback.
    }

    // Comparación por segmentos numéricos. La comparación lexicográfica de strings
    // está rota para versiones ("1.2.0" < "1.10.0" da falso con strings).
    const esObsoleta =
      this.compararVersiones(appVersion, versionMinimaRequerida) < 0;

    if (esObsoleta) {
      throw new ForbiddenException('Update Required');
    }

    return {
      valid: true,
      minVersion: versionMinimaRequerida,
      message: 'Versión compatible',
    };
  }

  /** Devuelve <0 si a<b, 0 si iguales, >0 si a>b, comparando segmento a segmento. */
  private compararVersiones(a: string, b: string): number {
    const segA = String(a || '0')
      .split('.')
      .map((s) => parseInt(s, 10) || 0);
    const segB = String(b || '0')
      .split('.')
      .map((s) => parseInt(s, 10) || 0);
    const largo = Math.max(segA.length, segB.length);
    for (let i = 0; i < largo; i++) {
      const diff = (segA[i] || 0) - (segB[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
}
