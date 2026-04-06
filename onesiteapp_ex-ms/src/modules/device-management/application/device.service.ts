import { Injectable, UnauthorizedException, NotFoundException } from '@nestjs/common';
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
}