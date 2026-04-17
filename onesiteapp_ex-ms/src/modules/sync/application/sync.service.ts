import { Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AckSyncDto } from '../domain/dtos/sync-deltas.dto';

@Injectable()
export class SyncService {
  constructor(private readonly dataSource: DataSource) {}

  // 1. Método Principal: TraerDeltas (POST) - Formato Nativo WatermelonDB
  async obtenerDeltas(lastSyncDates: Record<string, string | null>, deviceToken: string) {
    // Validar estado del dispositivo (Seguridad Física)
    const dispositivo = await this.dataSource.query(
      `SELECT IdDispositivo, Estado FROM Dispositivos_AppEx WHERE DeviceToken = @0`,
      [deviceToken]
    );

    if (!dispositivo.length || !dispositivo[0].Estado) {
      throw new UnauthorizedException('Device Blocked');
    }

    const idDispositivo = dispositivo[0].IdDispositivo;
    const serverTimestamp = new Date().toISOString(); // Marca de tiempo del servidor para la App

    // Objeto maestro que exige WatermelonDB
    const changes: any = {
      cat_menu_appex: { created: [], updated: [], deleted: [] },
      cat_parametros_appex: { created: [], updated: [], deleted: [] },
    };

    // --- SINCRONIZACIÓN DE CAT_MENU ---
    const menuSyncDate = lastSyncDates['cat_menu_appex'] || null;
    
    // Optimizamos: Comparamos con Control_Versiones primero
    const versionMenu = await this.dataSource.query(
      `SELECT UltimaModificacion FROM Control_Versiones_AppEx WHERE TablaNombre = 'Cat_Menu_AppEx'`
    );

    // Solo consultamos si nunca ha sincronizado o si hay una versión más reciente
    if (!menuSyncDate || new Date(versionMenu[0].UltimaModificacion) > new Date(menuSyncDate)) {
      
      // Obtenemos los deltas reales
      const menusQuery = menuSyncDate 
        ? `SELECT * FROM Cat_Menu_AppEx WHERE FechaModificacion > @0`
        : `SELECT * FROM Cat_Menu_AppEx`; // Si es null, trae todos
      
      const menus = await this.dataSource.query(menusQuery, menuSyncDate ? [menuSyncDate] : []);

      menus.forEach(row => {
        // WatermelonDB EXIGE que los IDs sean strings
        const watermelonRecord = {
          id: row.IdMenu.toString(),
          id_padre: row.IdPadre ? row.IdPadre.toString() : null,
          titulo: row.Titulo,
          icono: row.Icono,
          orden: row.Orden,
          ruta_pantalla: row.RutaPantalla,
          // No enviamos el 'Estado' a la app, WatermelonDB usa la lógica de deleted
        };

        if (!menuSyncDate) {
          // Si es la primera carga, todos los activos son 'created'
          if (row.Estado) changes.cat_menu_appex.created.push(watermelonRecord);
        } else {
          // Si es incremental
          if (row.Estado) {
            changes.cat_menu_appex.updated.push(watermelonRecord);
          } else {
            // Eliminado lógico en SQL -> Eliminación física en la App
            changes.cat_menu_appex.deleted.push(row.IdMenu.toString());
          }
        }
      });
    }

    // --- (AQUÍ REPETIRÍAMOS LA LÓGICA PARA CAT_PARAMETROS Y OTRAS TABLAS) ---.
    const paramSyncDate = lastSyncDates['cat_parametros_appex'] || null;
    const versionParam = await this.dataSource.query(
      `SELECT UltimaModificacion FROM Control_Versiones_AppEx WHERE TablaNombre = 'Cat_Parametros_AppEx'`
    );

    if (!paramSyncDate || new Date(versionParam[0].UltimaModificacion) > new Date(paramSyncDate)) {
      const paramQuery = paramSyncDate 
        ? `SELECT * FROM Cat_Parametros_AppEx WHERE FechaModificacion > @0`
        : `SELECT * FROM Cat_Parametros_AppEx`; 
      
      const parametros = await this.dataSource.query(paramQuery, paramSyncDate ? [paramSyncDate] : []);

      parametros.forEach(row => {
        const watermelonRecord = {
          id: row.Clave, // Usamos la Clave como ID obligatorio para WatermelonDB
          clave: row.Clave,
          valor: row.Valor,
        };

        if (!paramSyncDate) {
          // Primera carga: todo es nuevo
          changes.cat_parametros_appex.created.push(watermelonRecord);
        } else {
          // Carga incremental: actualizamos. (Asumimos que los parámetros no se eliminan, solo cambian de valor)
          changes.cat_parametros_appex.updated.push(watermelonRecord);
        }
      });
    }

    // Devolvemos el formato exacto que la función synchronize() de WatermelonDB espera
    return {
      changes,
      timestamp: serverTimestamp,
    };
  }

  // 2. Método: ConfirmarSinc (POST) - Auditoría (Reglas 3.2 y 3.5)
  async confirmarSincronizacion(dto: AckSyncDto, deviceToken: string) {
    const { tablaNombre, exitoso } = dto;

    const dispositivo = await this.dataSource.query(
      `SELECT IdDispositivo FROM Dispositivos_AppEx WHERE DeviceToken = @0`,
      [deviceToken]
    );

    if (dispositivo.length) {
      // Registramos en Log_Sincronizacion_AppEx que la App guardó los datos con éxito
      await this.dataSource.query(
        `INSERT INTO Log_Sincronizacion_AppEx (IdDispositivo, TablaNombre, FechaSinc, Exitoso)
         VALUES (@0, @1, GETDATE(), @2)`,
        [dispositivo[0].IdDispositivo, tablaNombre, exitoso ? 1 : 0]
      );
    }

    return { message: 'ACK recibido y auditado' };
  }

  // 3. Método: ObtenerParametros (GET) - Regla 3.1
  async obtenerParametros() {
    const parametros = await this.dataSource.query(
      `SELECT Clave, Valor FROM Cat_Parametros_AppEx`
    );
    
    // Transformamos el array de SQL a un objeto clave-valor simple
    const configGlobal = parametros.reduce((acc, curr) => {
      acc[curr.Clave] = curr.Valor;
      return acc;
    }, {});

    return configGlobal;
  }
}