import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AckSyncDto } from '../domain/dtos/sync-deltas.dto';

@Injectable()
export class SyncService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Regla 4.4 del Anexo 1: denegar deltas a versiones obsoletas de la App.
   * La versión mínima es parametrizable (Cat_Parametros_AppEx / VERSION_MINIMA_APP).
   */
  async validarVersionApp(appVersion: string) {
    let versionMinima = '1.0.0';
    try {
      const filas = await this.dataSource.query(
        `SELECT Valor FROM Cat_Parametros_AppEx WHERE Clave = 'VERSION_MINIMA_APP'`
      );
      if (filas.length && filas[0].Valor && String(filas[0].Valor).trim() !== '') {
        versionMinima = String(filas[0].Valor).trim();
      }
    } catch (e) {
      // Tabla ausente en ambientes antiguos: se conserva el fallback permisivo.
    }

    const segA = String(appVersion || '0').split('.').map(s => parseInt(s, 10) || 0);
    const segB = versionMinima.split('.').map(s => parseInt(s, 10) || 0);
    for (let i = 0; i < Math.max(segA.length, segB.length); i++) {
      const diff = (segA[i] || 0) - (segB[i] || 0);
      if (diff < 0) throw new ForbiddenException('Update Required');
      if (diff > 0) return;
    }
  }

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
          // Menú gateado por permisos (Anexo 1, sprint 3.2). NULL = visible para todos.
          id_permiso_requerido: row.IdPermisoRequerido != null ? row.IdPermisoRequerido.toString() : null,
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

  // ==========================================
  // 1. PULL: WatermelonDB pide datos nuevos
  // ==========================================
 async getChanges(lastPulledAt: number) {

    // 1. Preparar el timestamp de comparación
    // WatermelonDB envía el timestamp en milisegundos.
    const lastSyncDate = lastPulledAt 
      ? new Date(lastPulledAt).toISOString() 
      : '2016-01-01T00:00:00Z'; // Fecha base para descarga total propuesta de 10 años

    const serverTimestamp = new Date().getTime();
    const changes: any = {
      app_ex_encuesta: { created: [], updated: [], deleted: [] },
      app_ex_pregunta: { created: [], updated: [], deleted: [] },
    };
    
    try {
      // --- LÓGICA PARA ENCUESTAS ---
      // Se buscan encuestas creadas o modificadas después de la última sincronización
      const encuestas = await this.dataSource.query(
        `SELECT * FROM appEx_Encuesta WHERE FechaModificacion > @0`,
        [lastSyncDate]
      );

      encuestas.forEach(row => {
        const item = {
          id: row.IdEncuesta.toString(),
          nombre: row.Nombre,
          estado: row.Estado,
        };
        
        // Si la fecha de creación es muy cercana a la de modificación, es "created", si no, "updated"
        // Para simplificar la lógica offline, WatermelonDB acepta todo en "created" y hace UPSERT automático
        changes.app_ex_encuesta.created.push(item);
      });

      // --- LÓGICA PARA PREGUNTAS ---
      // Se obtienen las preguntas unificadas con sus reglas lógicas
      const preguntas = await this.dataSource.query(
        `SELECT p.*, r.SintaxisCalculo, r.ReglaValidacion, r.ReglaVisibilidad 
         FROM appEx_Pregunta p
         LEFT JOIN appEx_Reglas r ON p.IdPregunta = r.IdPregunta
         WHERE p.FechaModificacion > @0 OR r.FechaModificacion > @0`,
        [lastSyncDate]
      );

      preguntas.forEach(row => {
        changes.app_ex_pregunta.created.push({
          id: row.IdPregunta.toString(),
          encuesta_id: row.IdSeccion.toString(), // En este motor dinámico vinculamos a la sección/encuesta
          tipo_input: row.TipoDato,
          nombre_input: row.Etiqueta,
          obligatorio: row.EsObligatorio ? true : false,
          orden: row.Orden,
          valor_defecto: row.ValorDefecto || null,
          opciones: row.Opciones || null, // Se envía el string JSON de opciones
          catalogo: row.Catalogo || null
        });
      });

      // Nota: Para implementar 'deleted', se requeriría una tabla de auditoría (Soft Delete)
      // que registre los IDs eliminados y su fecha de borrado.

      return { 
        changes, 
        timestamp: serverTimestamp 
      };

    } catch (error) {
      console.error('Error al generar Deltas para WatermelonDB:', error);
      throw error;
    }
  }

  async processPush(changes: any) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const respuestasToCreate = changes.app_ex_respuesta?.created || [];
      const respuestasToUpdate = changes.app_ex_respuesta?.updated || [];

      // Procesar inserciones
      for (const resp of respuestasToCreate) {
        await queryRunner.query(
          `INSERT INTO appEx_Respuestas (IdPregunta, IdEncuesta, Valor, SyncStatus) VALUES (@0, @1, @2, 'SYNCED')`,
          [resp.pregunta_id, resp.encuesta_id, resp.valor]
        );
      }

      // Procesar actualizaciones
      for (const resp of respuestasToUpdate) {
        await queryRunner.query(
          `UPDATE appEx_Respuestas SET Valor = @0, SyncStatus = 'SYNCED' WHERE IdPregunta = @1 AND IdEncuesta = @2`,
          [resp.valor, resp.pregunta_id, resp.encuesta_id]
        );
      }

      await queryRunner.commitTransaction();
      return { success: true };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error procesando PUSH de WatermelonDB:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}