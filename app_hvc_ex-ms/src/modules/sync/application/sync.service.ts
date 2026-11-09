import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AckSyncDto } from '../domain/dtos/sync-deltas.dto';

/** Opción de menú de un rol: `auth.Menu` unida a `auth.Acceso`. */
interface FilaMenu {
  id: string;
  label: string;
  icono: string | null;
  Orden: number | null;
  pathApp: string | null;
  MenuPadreId: string | null;
}

@Injectable()
export class SyncService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Regla 4.4 del Anexo 1: denegar deltas a versiones obsoletas de la App.
   * La versión mínima es parametrizable (app.Cat_Parametros / VERSION_MINIMA_APP).
   */
  async validarVersionApp(appVersion: string) {
    let versionMinima = '1.0.0';
    try {
      const filas = await this.dataSource.query(
        `SELECT Valor FROM app.Cat_Parametros WHERE Clave = 'VERSION_MINIMA_APP'`,
      );
      if (
        filas.length &&
        filas[0].Valor &&
        String(filas[0].Valor).trim() !== ''
      ) {
        versionMinima = String(filas[0].Valor).trim();
      }
    } catch (e) {
      // Tabla ausente en ambientes antiguos: se conserva el fallback permisivo.
    }

    const segA = String(appVersion || '0')
      .split('.')
      .map((s) => parseInt(s, 10) || 0);
    const segB = versionMinima.split('.').map((s) => parseInt(s, 10) || 0);
    for (let i = 0; i < Math.max(segA.length, segB.length); i++) {
      const diff = (segA[i] || 0) - (segB[i] || 0);
      if (diff < 0) throw new ForbiddenException('Update Required');
      if (diff > 0) return;
    }
  }

  /**
   * Quién está usando el equipo, para armarle SU menú.
   *
   * Se prefiere la sesión activa sobre el dueño del enrolamiento: en un equipo
   * compartido, el menú debe ser el de quien inició sesión, no el de quien lo
   * enroló. El dueño es el respaldo, y siempre existe (columna NOT NULL).
   */
  private async usuarioDelEquipo(
    idDispositivo: number,
    idDuenio: string | null,
  ): Promise<string | null> {
    try {
      const sesion = await this.dataSource.query<Array<{ IdUsuario: string }>>(
        `SELECT TOP 1 IdUsuario FROM app.Sesiones
         WHERE IdDispositivo = @0 AND Activa = 1
         ORDER BY IdSesion DESC`,
        [idDispositivo],
      );
      if (sesion.length) return sesion[0].IdUsuario;
    } catch (e) {
      console.warn(
        `[SYNC] No se pudo leer la sesión activa del equipo ${idDispositivo}:`,
        e instanceof Error ? e.message : e,
      );
    }
    return idDuenio;
  }

  // 1. Método Principal: TraerDeltas (POST) - Formato Nativo WatermelonDB
  async obtenerDeltas(
    lastSyncDates: Record<string, string | null>,
    deviceToken: string,
  ) {
    // Validar estado del dispositivo (Seguridad Física)
    const dispositivo = await this.dataSource.query<
      Array<{
        IdDispositivo: number;
        Estado: boolean;
        IdUsuario: string | null;
      }>
    >(
      `SELECT IdDispositivo, Estado, IdUsuario FROM app.Dispositivos WHERE DeviceToken = @0`,
      [deviceToken],
    );
    if (!dispositivo.length || !dispositivo[0].Estado) {
      throw new UnauthorizedException('Device Blocked');
    }
    const idDispositivo = dispositivo[0].IdDispositivo;

    // De QUIÉN es el menú. El menú depende del ROL, así que hay que saber quién
    // pide. Se prefiere la sesión activa (quien inició sesión ahora) y se cae al
    // dueño del enrolamiento, que siempre existe. No se usa la cabecera x-user-id:
    // el cliente la elige y pediría el menú de otro.
    const idUsuario = await this.usuarioDelEquipo(
      idDispositivo,
      dispositivo[0].IdUsuario,
    );
    const serverTimestamp = new Date().toISOString(); // Marca de tiempo del servidor para la App

    // Objeto maestro que exige WatermelonDB
    const changes: any = {
      cat_menu_appex: { created: [], updated: [], deleted: [] },
      cat_parametros_appex: { created: [], updated: [], deleted: [] },
    };

    // --- SINCRONIZACIÓN DEL MENÚ (auth.Acceso: los menús son POR ROL) ---
    //
    // El orden y la jerarquía NO viven en auth.Menu sino en auth.Acceso, que es
    // quien ata un rol con los menús que puede ver: ordenMenu, mainMenuId y la
    // bandera showApp (1 = va al teléfono, 0 = solo BackOffice).
    //
    // SIN FILTRO INCREMENTAL a propósito: quitarle un menú a un rol no modifica
    // auth.Menu, así que una sincronización por fecha no se enteraría nunca. Son
    // unas pocas filas por usuario; se manda el juego completo cada vez.
    const menuSyncDate = lastSyncDates['cat_menu_appex'] || null;

    const menus = await this.dataSource.query<Array<FilaMenu>>(
      `SELECT m.id, m.label, m.icono, m.pathApp,
              a.ordenMenu AS Orden, a.mainMenuId AS MenuPadreId
       FROM auth.Acceso a
       INNER JOIN auth.Menu m ON m.id = a.menuId
       INNER JOIN auth.Usuario u ON u.rolId = a.rolId
       WHERE u.id = @0 AND a.showApp = 1 AND m.activo = 1 AND m.deleted_at IS NULL
       ORDER BY a.ordenMenu ASC`,
      [idUsuario],
    );

    console.log(
      `[SYNC] menú de ${idUsuario} -> ${menus.length} opción(es) con showApp = 1`,
    );

    menus.forEach((row) => {
      // WatermelonDB EXIGE que los IDs sean strings; aquí ya son GUID.
      const watermelonRecord = {
        id: String(row.id),
        id_padre: row.MenuPadreId ? String(row.MenuPadreId) : null,
        titulo: row.label,
        icono: row.icono,
        orden: row.Orden ?? 0,
        ruta_pantalla: row.pathApp,
        // Ya no hace falta gatear por permiso en el móvil: el filtro ocurrió en
        // el JOIN. Lo que llega es exactamente lo que este rol puede ver.
        id_permiso_requerido: null,
      };

      // created también en incremental: WatermelonDB hace upsert y así un menú
      // concedido después del primer login entra sin caso especial.
      changes.cat_menu_appex.created.push(watermelonRecord);
    });

    // Un acceso REVOCADO debe desaparecer del teléfono. Solo en sincronizaciones
    // posteriores: en la primera no hay nada local que borrar.
    if (menuSyncDate) {
      const visibles = new Set(menus.map((m) => String(m.id)));
      const todos = await this.dataSource.query<Array<{ id: string }>>(
        `SELECT id FROM auth.Menu`,
      );
      changes.cat_menu_appex.deleted = todos
        .map((m) => String(m.id))
        .filter((id) => !visibles.has(id));
    }

    // --- (AQUÍ REPETIRÍAMOS LA LÓGICA PARA CAT_PARAMETROS Y OTRAS TABLAS) ---.
    const paramSyncDate = lastSyncDates['cat_parametros_appex'] || null;
    const versionParam = await this.dataSource.query(
      `SELECT UltimaModificacion FROM app.ControlVersiones WHERE TablaNombre = 'app.Cat_Parametros'`,
    );

    // Mismo blindaje que en el bloque de menú (ver comentario arriba).
    const ultimaModParam = versionParam?.[0]?.UltimaModificacion ?? null;
    if (
      !paramSyncDate ||
      !ultimaModParam ||
      new Date(ultimaModParam) > new Date(paramSyncDate)
    ) {
      const paramQuery = paramSyncDate
        ? `SELECT Clave, Valor FROM app.Cat_Parametros WHERE FechaModificacion > @0`
        : `SELECT Clave, Valor FROM app.Cat_Parametros`;

      const parametros = await this.dataSource.query<
        Array<{ Clave: string; Valor: string | null }>
      >(paramQuery, paramSyncDate ? [paramSyncDate] : []);

      parametros.forEach((row) => {
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
      `SELECT IdDispositivo FROM app.Dispositivos WHERE DeviceToken = @0`,
      [deviceToken],
    );

    if (dispositivo.length) {
      // Registramos en app.LogSincronizacion que la App guardó los datos con éxito
      await this.dataSource.query(
        `INSERT INTO app.LogSincronizacion (IdDispositivo, TablaNombre, FechaSinc, Exitoso)
         VALUES (@0, @1, GETDATE(), @2)`,
        [dispositivo[0].IdDispositivo, tablaNombre, exitoso ? 1 : 0],
      );
    }

    // Se devuelve la hora del MOTOR, no la del dispositivo ni la del proceso Node.
    // La app la usa para sellar su marca de última sincronización, y los deltas se
    // filtran con `FechaModificacion > @0` sobre esa misma referencia: si la app
    // sellara con su propio reloj, un móvil adelantado dejaría fuera del filtro
    // registros que sí cambiaron y los ocultaría de forma permanente.
    const [{ ahora }] = await this.dataSource.query(
      `SELECT CONVERT(VARCHAR(23), GETDATE(), 126) AS ahora`,
    );

    return { message: 'ACK recibido y auditado', timestampServidor: ahora };
  }

  // 3. Método: ObtenerParametros (GET) - Regla 3.1
  async obtenerParametros() {
    const parametros = await this.dataSource.query(
      `SELECT Clave, Valor FROM app.Cat_Parametros`,
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
        [lastSyncDate],
      );

      encuestas.forEach((row) => {
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
        [lastSyncDate],
      );

      preguntas.forEach((row) => {
        changes.app_ex_pregunta.created.push({
          id: row.IdPregunta.toString(),
          encuesta_id: row.IdSeccion.toString(), // En este motor dinámico vinculamos a la sección/encuesta
          tipo_input: row.TipoDato,
          nombre_input: row.Etiqueta,
          obligatorio: row.EsObligatorio ? true : false,
          orden: row.Orden,
          valor_defecto: row.ValorDefecto || null,
          opciones: row.Opciones || null, // Se envía el string JSON de opciones
          catalogo: row.Catalogo || null,
        });
      });

      // Nota: Para implementar 'deleted', se requeriría una tabla de auditoría (Soft Delete)
      // que registre los IDs eliminados y su fecha de borrado.

      return {
        changes,
        timestamp: serverTimestamp,
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
          [resp.pregunta_id, resp.encuesta_id, resp.valor],
        );
      }

      // Procesar actualizaciones
      for (const resp of respuestasToUpdate) {
        await queryRunner.query(
          `UPDATE appEx_Respuestas SET Valor = @0, SyncStatus = 'SYNCED' WHERE IdPregunta = @1 AND IdEncuesta = @2`,
          [resp.valor, resp.pregunta_id, resp.encuesta_id],
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
