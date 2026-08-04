import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  aFechaLocalSqlServer,
  ahoraLocalSqlServer,
  esZonaHorariaValida,
  ZONA_HORARIA_POR_DEFECTO,
} from '../domain/fechas';

/**
 * Lee una bandera booleana de una fila SQL admitiendo varios alias de columna,
 * porque el BackOffice puede nombrarla distinto a lo documentado (ej. EsObligatorio
 * vs. Obligatorio vs. EsRequerido). Normaliza BIT/1/'1'/true a 1, cualquier otra
 * cosa (incluida la ausencia de la columna) a 0.
 */
function leerBandera(row: Record<string, unknown>, ...alias: string[]): 0 | 1 {
  for (const nombre of alias) {
    const valor = row[nombre];
    if (valor !== undefined && valor !== null) {
      return (valor === 1 || valor === '1' || valor === true) ? 1 : 0;
    }
  }
  return 0;
}

@Injectable()
export class SurveysService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) { }

  /**
   * Zona horaria de la operación. Se declara EXPLÍCITAMENTE en vez de heredar la del
   * proceso: en un servidor Linux con TZ=UTC —lo habitual— heredarla hacía que las
   * fechas del dispositivo se guardaran 6 h adelantadas, con la fecha correcta y solo
   * la hora desplazada. Si la zona configurada no es válida se avisa y se usa la de
   * por defecto, en vez de corromper las capturas en silencio.
   */
  private zonaHoraria(): string {
    const configurada = this.configService.get<string>('APP_ZONA_HORARIA', ZONA_HORARIA_POR_DEFECTO);
    if (!esZonaHorariaValida(configurada)) {
      console.warn(
        `[FECHAS] APP_ZONA_HORARIA="${configurada}" no es una zona IANA válida; ` +
        `se usa ${ZONA_HORARIA_POR_DEFECTO}.`,
      );
      return ZONA_HORARIA_POR_DEFECTO;
    }
    return configurada;
  }

  /**
   * El servicio obtiene la estructura maestra de la encuesta.
   * Se formatea la respuesta en el estándar nativo de WatermelonDB (Deltas).
   */
  async getSurveyStructure(lastSyncDate: string | null) {
    const serverTimestamp = new Date().toISOString();

    // Se inicializa el objeto de cambios exigido por WatermelonDB
    const changes: any = {
      local_encuesta: { created: [], updated: [], deleted: [] },
      local_seccion: { created: [], updated: [], deleted: [] },
      local_estructura_pregunta: { created: [], updated: [], deleted: [] },
    };

    // 1. Se extraen las encuestas activas
    const encuestas = await this.dataSource.query(`SELECT * FROM appEx_Encuesta`);
    encuestas.forEach(row => {
      changes.local_encuesta.created.push({
        id: row.IdEncuesta.toString(),
        nombre: row.Nombre,
        version_activa: row.VersionActiva,
        orden: 1, // Se asigna orden por defecto
        fecha_modificacion: row.FechaModificacion.toISOString()
      });
    });

    // 2. Se extraen las secciones
    const secciones = await this.dataSource.query(`SELECT * FROM appEx_Seccion`);
    secciones.forEach(row => {
      changes.local_seccion.created.push({
        id: row.IdSeccion.toString(),
        id_encuesta: row.IdEncuesta.toString(),
        nombre: row.Titulo || row.Nombre, // <--- Cambiamos 'titulo' por 'nombre'
        orden: row.Orden,
        es_visible_default: row.EsVisibleDefault ? 1 : 0
      });
    });

    // 3. Se extraen las preguntas unidas con sus reglas (JOIN)
    const preguntas = await this.dataSource.query(`
      SELECT p.*, r.SintaxisCalculo, r.ReglaValidacion, r.ReglaVisibilidad 
      FROM appEx_Pregunta p
      LEFT JOIN appEx_Reglas r ON p.IdPregunta = r.IdPregunta
    `);
    console.log(`📡 [BACKEND] Preguntas encontradas en BD: ${preguntas.length}`);

    preguntas.forEach(row => {
      changes.local_estructura_pregunta.created.push({
        id: row.IdPregunta.toString(),
        id_seccion: row.IdSeccion.toString(),
        id_matriz_padre: row.IdMatrizPadre ? row.IdMatrizPadre.toString() : null,

        // --- CAMPOS CRÍTICOS AGREGADOS ---
        etiqueta: row.Etiqueta,    // <--- ESTO FALTABA
        opciones: row.Opciones,    // <--- ESTO FALTABA (para Radio/Checkbox)
        // Admite varios alias de columna por si el BackOffice la nombró distinto
        // a lo documentado; sin esto la bandera cae siempre a 0 en silencio.
        es_obligatorio: leerBandera(row, 'EsObligatorio', 'Obligatorio', 'EsRequerido', 'Requerido', 'es_obligatorio'),
        // ---------------------------------

        tipo_dato: row.TipoDato,
        origen_datos_tipo: row.OrigenDatosTipo,
        origen_datos_cmd: row.OrigenDatosCmd,
        es_editable: leerBandera(row, 'EsEditable', 'es_editable'),
        es_visible_default: leerBandera(row, 'EsVisibleDefault', 'es_visible_default'),
        orden: row.Orden,
        sintaxis_calculo: row.SintaxisCalculo,
        regla_visibilidad: row.ReglaVisibilidad,
        regla_validacion: row.ReglaValidacion
      });
    });

    return { changes, timestamp: serverTimestamp };
  }

  /**
   * El servicio obtiene las opciones de los catálogos maestros.
   * Se formatea la respuesta para el motor local de WatermelonDB.
   */
  async getCatalogs(lastSyncDate: string | null) {
    const serverTimestamp = new Date().toISOString();

    const changes: any = {
      local_catalogos: { created: [], updated: [], deleted: [] },
    };

    // Se extraen los catálogos de la base de datos
    const catalogos = await this.dataSource.query(`SELECT * FROM appEx_Catalogos_Maestro`);

    catalogos.forEach(row => {
      changes.local_catalogos.created.push({
        id: row.IdCatalogo.toString(),
        nombre_catalogo: row.NombreCatalogo,
        codigo_opcion: row.CodigoOpcion,
        valor_opcion: row.ValorOpcion,
        id_padre_opcion: row.IdPadreOpcion || null
      });
    });

    return { changes, timestamp: serverTimestamp };
  }

  /**
   * El servicio recibe el bloque masivo de respuestas desde la App (S5.2).
   * Procesa respuestas planas y matrices utilizando el UUID_Instancia.
   */
  async submitSurvey(userId: number, payload: any) {
    const {
      idEncuesta,
      respuestas,
      fechaInicio,
      fechaFin,
      latitud,
      longitud,
      dispositivoId
    } = payload;

    const zona = this.zonaHoraria();

    // El sistema inicia una Transacción SQL para asegurar integridad.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Usamos RAW QUERY con cláusula OUTPUT para SQL Server.
      // Esto asegura el retorno del ID sin importar si la entidad TypeORM está decorada o no.
      const resultHeader = await queryRunner.manager.query(`
        INSERT INTO appEx_Encabezado_Captura 
        (IdEncuesta, IdUsuario, FechaInicio, FechaFin, Latitud, Longitud, DispositivoID)
        OUTPUT inserted.IdCaptura
        VALUES (@0, @1, @2, @3, @4, @5, @6)
      `, [
        idEncuesta,
        userId,
        // El dispositivo envía ISO-8601 en UTC ("...Z"). Las columnas son DATETIME
        // (sin zona), así que insertar el string crudo guardaba la hora UTC como si
        // fuera local y quedaba ~6 h por delante de FechaSincronizacion, que usa
        // GETDATE() (hora local). Se convierte a hora local para que las tres
        // columnas de la fila sean coherentes entre sí.
        aFechaLocalSqlServer(fechaInicio, zona) || ahoraLocalSqlServer(zona),
        aFechaLocalSqlServer(fechaFin, zona) || ahoraLocalSqlServer(zona),
        latitud || null,
        longitud || null,
        dispositivoId || 'APP_OFFLINE'
      ]);

      // Se cierra correctamente la validación de error.
      if (!resultHeader || resultHeader.length === 0) {
        throw new Error("La inserción falló: SQL Server no devolvió la fila creada.");
      } 
      // EL CÓDIGO CONTINÚA NORMALMENTE SI PASÓ LA VALIDACIÓN

      // El id se lee POR NOMBRE, no por posición. La versión anterior tomaba
      // `Object.keys(filaCreada)[0]` asumiendo que la llave primaria era la primera
      // columna de la tabla: bastaba con que alguien reordenara `appEx_Encabezado_Captura`
      // en el BackOffice para que el `IdCaptura` pasara a ser un `IdEncuesta` o una
      // fecha, silenciosamente. Ahora el `OUTPUT` pide exactamente la columna que se
      // necesita, así que la consulta falla de forma visible si esa columna cambia.
      const filaCreada = resultHeader[0] as { IdCaptura: number | string };
      const nuevoIdCaptura = filaCreada?.IdCaptura;

      if (nuevoIdCaptura === undefined || nuevoIdCaptura === null) {
        throw new Error('La inserción no devolvió IdCaptura.');
      }

      // `IdCaptura` es BIGINT y se propaga como STRING a partir de aquí. Convertirlo a
      // number podría superar Number.MAX_SAFE_INTEGER y redondearse sin ningún error:
      // los archivos de multimedia quedarían colgados de OTRA captura. El driver ya lo
      // devuelve como string cuando excede ese rango, así que se normaliza en un punto.
      const idCapturaTexto = String(nuevoIdCaptura);

      console.log(`✅ [SQL] Encabezado creado con IdCaptura: ${idCapturaTexto}`);

      // 4. Insertamos las respuestas usando el nuevoIdCaptura extraído dinámicamente
      for (const resp of respuestas) {
        console.log(` [PROCESANDO RESPUESTA] Pregunta ID: ${resp.idPregunta} -> Valor enviado: "${resp.valor}"`);
        await queryRunner.manager.createQueryBuilder()
          .insert()
          .into('appEx_Respuestas')
          .values({
            IdEncuesta: idEncuesta,
            IdPregunta: resp.idPregunta,
            UUID_Instancia: resp.uuidInstancia || null,
            Valor: resp.valor || null,
            IdCaptura: nuevoIdCaptura
          })
          .execute();
      }

      await queryRunner.commitTransaction();

      // `idCaptura` es lo que habilita el flujo en dos fases de multimedia: el
      // dispositivo no puede conocerlo al capturar la foto (es un IDENTITY que genera
      // el motor aquí mismo), así que lo recibe en esta respuesta y lo estampa en su
      // cola local para poder subir después los binarios. Es un campo AÑADIDO: las
      // versiones de la app que no lo lean siguen funcionando igual.
      return {
        success: true,
        message: 'Encuesta sincronizada correctamente',
        idCaptura: idCapturaTexto,
      };

    } catch (error: any) {
      console.error('❌ ERROR CRÍTICO EN SQL (submitSurvey):', error.message || error);
      await queryRunner.rollbackTransaction();
      throw new Error(`Error BD: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }
}