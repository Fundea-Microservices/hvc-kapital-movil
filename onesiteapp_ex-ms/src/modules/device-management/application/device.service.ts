import { Injectable, UnauthorizedException, NotFoundException, ForbiddenException } from '@nestjs/common';
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
      [codigoEnrolamiento]
    );

    if (!empresa.length || !empresa[0].Estado) {
      throw new UnauthorizedException('Código de empresa inválido o inactivo');
    }

    const companyName = empresa[0].NombreEmpresa;

    const dispositivoExistente = await this.dataSource.query(
      `SELECT IdDispositivo, Estado, DeviceToken FROM Dispositivos_AppEX WHERE HardwareID = @0`,
      [hardwareId]
    );

    if (dispositivoExistente.length > 0) {
      if (!dispositivoExistente[0].Estado) {
         throw new UnauthorizedException('Dispositivo bloqueado (Device Blocked)');
      }
      return { 
        message: 'Equipo ya enrolado', 
        deviceToken: dispositivoExistente[0].DeviceToken,
        companyName: companyName // Añadido a la respuesta
      };
    }

    const newDeviceToken = randomUUID();

    await this.dataSource.query(
      `INSERT INTO Dispositivos_AppEX (HardwareID, DeviceToken, Estado, FechaIngreso, FechaModificacion) 
       VALUES (@0, @1, 1, GETDATE(), GETDATE())`,
      [hardwareId, newDeviceToken]
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
      [deviceToken]
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
      [modelo, versionSO, deviceToken]
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
      [deviceToken]
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
      [deviceToken]
    );

    // 3. Regla Crítica 4.5: Bloqueo de hardware superior a sesión
    // Por seguridad extrema, también invalidamos cualquier sesión activa de este equipo
    await this.dataSource.query(
      `UPDATE Sesiones 
       SET Activa = 0 
       WHERE IdDispositivo = @0`,
      [dispositivo[0].IdDispositivo]
    );

    return { message: 'Dispositivo bloqueado exitosamente. Se ejecutará Wipe en su próxima petición.' };
  }

  // SPRINT 4: Método 4.1 - VerificarVersion (GET)
  async verificarVersion(appVersion: string) {
    // En un entorno real, la versión mínima se leería de la tabla Cat_Parametros
    const versionMinimaRequerida = '1.0.0'; 
    
    // Lógica básica de comparación de versiones
    const isObsolete = appVersion < versionMinimaRequerida;

    if (isObsolete) {
      throw new ForbiddenException('Update Required');
    }

    return { 
      valid: true, 
      message: 'Versión compatible' 
    };
  }

}