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

    // El código identifica a una PERSONA (auth.Usuario), no a una empresa: el mismo
    // APK sirve a personal interno y a clientes, cada uno con su propio código.
    const usuario = await this.dataSource.query<
      Array<{
        IdUsuario: string;
        NombreUsuario: string | null;
        Activo: boolean;
        Sucursal: string | null;
      }>
    >(
      `SELECT TOP 1 u.id AS IdUsuario, u.nombreCompleto AS NombreUsuario,
              u.activo AS Activo, s.nombre AS Sucursal
       FROM auth.Usuario u
       LEFT JOIN auth.sucursal s ON s.id = u.sucursalId
       WHERE u.CodigoEnrolamiento = @0 AND u.deleted_at IS NULL`,
      [codigoEnrolamiento],
    );

    if (!usuario.length || !usuario[0].Activo) {
      throw new UnauthorizedException(
        'Código de enrolamiento inválido o inactivo',
      );
    }

    const idUsuario = usuario[0].IdUsuario;
    // La app muestra este nombre como origen del equipo; la sucursal es lo más
    // cercano a "dónde opera" ahora que no hay tabla de empresas.
    const companyName = usuario[0].Sucursal || 'HVC Kapital';

    const dispositivoExistente = await this.dataSource.query(
      `SELECT IdDispositivo, Estado, DeviceToken FROM app.Dispositivos WHERE HardwareID = @0`,
      [hardwareId],
    );

    if (dispositivoExistente.length > 0) {
      if (!dispositivoExistente[0].Estado) {
        throw new UnauthorizedException(
          'Dispositivo bloqueado (Device Blocked)',
        );
      }

      // Re-enrolar con otro código reasigna el equipo a ese usuario: es como se
      // reutiliza un equipo devuelto o se traslada a otra persona.
      await this.dataSource.query(
        `UPDATE app.Dispositivos SET IdUsuario = @1, FechaModificacion = GETDATE()
         WHERE IdDispositivo = @0`,
        [dispositivoExistente[0].IdDispositivo, idUsuario],
      );

      return {
        message: 'Equipo ya enrolado',
        deviceToken: dispositivoExistente[0].DeviceToken,
        companyName: companyName, // Añadido a la respuesta
      };
    }

    const newDeviceToken = randomUUID();

    // El dispositivo queda VINCULADO al usuario dueño del código (FK IdUsuario).
    await this.dataSource.query(
      `INSERT INTO app.Dispositivos (HardwareID, DeviceToken, IdUsuario, Estado, FechaIngreso, FechaModificacion)
       VALUES (@0, @1, @2, 1, GETDATE(), GETDATE())`,
      [hardwareId, newDeviceToken, idUsuario],
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
      `SELECT IdDispositivo, Estado FROM app.Dispositivos WHERE DeviceToken = @0`,
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
      `UPDATE app.Dispositivos
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
    const dispositivo = await this.dataSource.query<Array<{ IdDispositivo: number }>>(
      `SELECT IdDispositivo FROM app.Dispositivos WHERE DeviceToken = @0`,
      [deviceToken],
    );

    if (!dispositivo.length) {
      throw new NotFoundException('Dispositivo no encontrado');
    }

    // 2. Bloqueo administrativo (Estado = 0)
    // El Trigger de SQL Server actualizará Control_Versiones automáticamente
    await this.dataSource.query(
      `UPDATE app.Dispositivos
       SET Estado = 0, FechaModificacion = GETDATE()
       WHERE DeviceToken = @0`,
      [deviceToken],
    );

    // 3. Regla Crítica 4.5: Bloqueo de hardware superior a sesión
    // Por seguridad extrema, también invalidamos cualquier sesión activa de este equipo
    await this.invalidarSesiones(dispositivo[0].IdDispositivo);

    return {
      message:
        'Dispositivo bloqueado exitosamente. Se ejecutará Wipe en su próxima petición.',
    };
  }

  /**
   * Desvinculación self-service del dispositivo (desde Login o Dashboard).
   *
   * NO autenticada: se autoriza por posesión del `deviceToken` del equipo enrolado (a
   * diferencia del bloqueo admin `darDeBaja`, que lo dispara el BackOffice). Invalida
   * las sesiones del equipo. NO pone `Estado = 0`: eso bloquearía el re-enrolamiento
   * del mismo hardware (`enrolarEquipo` rechaza los dispositivos con `Estado = 0`).
   *
   * El dueño (`IdUsuario`) se CONSERVA: la columna no admite nulos y re-enrolar ya
   * reasigna el equipo al dueño del código usado. Además deja rastro de quién lo tuvo.
   */
  async desvincular(deviceToken: string) {
    const dispositivo = await this.dataSource.query<Array<{ IdDispositivo: number }>>(
      `SELECT IdDispositivo FROM app.Dispositivos WHERE DeviceToken = @0`,
      [deviceToken],
    );

    if (!dispositivo.length) {
      throw new NotFoundException('Dispositivo no encontrado');
    }

    await this.dataSource.query(
      `UPDATE app.Dispositivos SET FechaModificacion = GETDATE() WHERE IdDispositivo = @0`,
      [dispositivo[0].IdDispositivo],
    );
    await this.invalidarSesiones(dispositivo[0].IdDispositivo);

    return { message: 'Dispositivo desvinculado correctamente' };
  }

  /**
   * Apaga las sesiones del equipo. Best-effort a propósito: el equipo ya quedó
   * desvinculado o bloqueado, y un fallo aquí no debe devolver 500 y dejar a la
   * app atrapada sin poder re-enrolar.
   */
  private async invalidarSesiones(idDispositivo: number) {
    try {
      await this.dataSource.query(
        `UPDATE app.Sesiones SET Activa = 0 WHERE IdDispositivo = @0`,
        [idDispositivo],
      );
    } catch (e) {
      console.warn(
        `[DISPOSITIVOS] No se pudieron invalidar las sesiones del equipo ${idDispositivo}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // SPRINT 4: Método 4.1 - VerificarVersion (GET)
  async verificarVersion(appVersion: string) {
    // La versión mínima es PARAMETRIZABLE desde el BackOffice (app.Cat_Parametros,
    // clave VERSION_MINIMA_APP). Si la clave no existe, se usa el fallback y toda
    // versión es aceptada — mismo comportamiento previo, nada se rompe.
    let versionMinimaRequerida = '1.0.0';
    try {
      const filas = await this.dataSource.query(
        `SELECT Valor FROM app.Cat_Parametros WHERE Clave = 'VERSION_MINIMA_APP'`,
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
