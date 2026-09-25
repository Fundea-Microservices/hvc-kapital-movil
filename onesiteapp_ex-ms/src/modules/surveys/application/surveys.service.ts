import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  aFechaLocalSqlServer,
  ahoraLocalSqlServer,
  esZonaHorariaValida,
  esFechaDispositivoRazonable,
  ZONA_HORARIA_POR_DEFECTO,
} from '../domain/fechas';
import { type EncuestaRechazadaDto } from '../domain/dtos/encuesta-rechazada.dto';

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
      return valor === 1 || valor === '1' || valor === true ? 1 : 0;
    }
  }
  return 0;
}

/**
 * Convierte a texto un identificador que llega de SQL Server, o devuelve null si la
 * columna viene vacía. Se hace aquí y no con `.toString()` directo porque una sola fila
 * con la llave en NULL —cosa que el BackOffice permite crear— tumbaba TODA la estructura
 * con un 500 y dejaba a los asesores sin poder sincronizar.
 */
function aTextoId(valor: unknown): string | null {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

/**
 * Normaliza a ISO-8601 una fecha de SQL Server (el driver la entrega como `Date`, pero
 * puede llegar como string o NULL). Ante cualquier valor inservible devuelve el respaldo
 * indicado en vez de lanzar: la estructura de la encuesta debe viajar igual, una fecha
 * ausente no vale una sincronización rota.
 */
function aIsoODefecto(valor: unknown, respaldo: string): string {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? respaldo : valor.toISOString();
  }
  if (typeof valor === 'string' || typeof valor === 'number') {
    const fecha = new Date(valor);
    if (!Number.isNaN(fecha.getTime())) return fecha.toISOString();
  }
  return respaldo;
}

@Injectable()
export class SurveysService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Zona horaria de la operación. Se declara EXPLÍCITAMENTE en vez de heredar la del
   * proceso: en un servidor Linux con TZ=UTC —lo habitual— heredarla hacía que las
   * fechas del dispositivo se guardaran 6 h adelantadas, con la fecha correcta y solo
   * la hora desplazada. Si la zona configurada no es válida se avisa y se usa la de
   * por defecto, en vez de corromper las capturas en silencio.
   */
  private zonaHoraria(): string {
    const configurada = this.configService.get<string>(
      'APP_ZONA_HORARIA',
      ZONA_HORARIA_POR_DEFECTO,
    );
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

    // Regla transversal de este método: una fila mal formada se OMITE y se registra,
    // nunca aborta la respuesta. Un 500 aquí deja sin sincronizar a todos los asesores
    // —el pull de la app lanza este endpoint junto a otros dos y basta uno para tumbar
    // el ciclo completo—, mientras que omitir una encuesta huérfana solo afecta a esa.
    const omitidas: string[] = [];

    // 1. Se extraen las encuestas activas
    const encuestas = await this.dataSource.query(
      `SELECT * FROM appEx_Encuesta`,
    );
    encuestas.forEach((row) => {
      const id = aTextoId(row.IdEncuesta);
      if (!id) {
        omitidas.push('appEx_Encuesta sin IdEncuesta');
        return;
      }
      changes.local_encuesta.created.push({
        id,
        nombre: row.Nombre,
        version_activa: row.VersionActiva,
        orden: 1, // Se asigna orden por defecto
        // FechaModificacion es NULL en filas creadas por el BackOffice sin pasar por el
        // DEFAULT GETDATE(). Se cae a la hora del servidor: la app solo la usa como
        // marca de versión, así que una fecha reciente es inocua, y el `.toISOString()`
        // directo sobre NULL era justo lo que devolvía 500 en producción.
        fecha_modificacion: aIsoODefecto(
          row.FechaModificacion,
          serverTimestamp,
        ),
      });
    });

    // 2. Se extraen las secciones
    const secciones = await this.dataSource.query(
      `SELECT * FROM appEx_Seccion`,
    );
    secciones.forEach((row) => {
      const id = aTextoId(row.IdSeccion);
      const idEncuesta = aTextoId(row.IdEncuesta);
      // Sin encuesta padre la sección no tiene dónde colgarse en el móvil.
      if (!id || !idEncuesta) {
        omitidas.push(`appEx_Seccion ${id ?? '(sin id)'} sin IdEncuesta`);
        return;
      }
      changes.local_seccion.created.push({
        id,
        id_encuesta: idEncuesta,
        nombre: row.Titulo || row.Nombre, // <--- Cambiamos 'titulo' por 'nombre'
        orden: row.Orden,
        es_visible_default: row.EsVisibleDefault ? 1 : 0,
      });
    });

    // 3. Se extraen las preguntas unidas con sus reglas (JOIN)
    const preguntas = await this.dataSource.query(`
      SELECT p.*, r.SintaxisCalculo, r.ReglaValidacion, r.ReglaVisibilidad, r.MensajeError, r.MensajeNotificacion
      FROM appEx_Pregunta p
      LEFT JOIN appEx_Reglas r ON p.IdPregunta = r.IdPregunta
    `);
    console.log(
      `📡 [BACKEND] Preguntas encontradas en BD: ${preguntas.length}`,
    );

    preguntas.forEach((row) => {
      const id = aTextoId(row.IdPregunta);
      const idSeccion = aTextoId(row.IdSeccion);
      // La app resuelve la encuesta de cada pregunta a través de su sección; sin
      // IdSeccion la pregunta no se puede pintar en ningún formulario.
      if (!id || !idSeccion) {
        omitidas.push(`appEx_Pregunta ${id ?? '(sin id)'} sin IdSeccion`);
        return;
      }
      changes.local_estructura_pregunta.created.push({
        id,
        id_seccion: idSeccion,
        id_matriz_padre: aTextoId(row.IdMatrizPadre),

        // --- CAMPOS CRÍTICOS AGREGADOS ---
        etiqueta: row.Etiqueta, // <--- ESTO FALTABA
        opciones: row.Opciones, // <--- ESTO FALTABA (para Radio/Checkbox)
        // Admite varios alias de columna por si el BackOffice la nombró distinto
        // a lo documentado; sin esto la bandera cae siempre a 0 en silencio.
        es_obligatorio: leerBandera(
          row,
          'EsObligatorio',
          'Obligatorio',
          'EsRequerido',
          'Requerido',
          'es_obligatorio',
        ),
        // ---------------------------------

        tipo_dato: row.TipoDato,
        origen_datos_tipo: row.OrigenDatosTipo,
        origen_datos_cmd: row.OrigenDatosCmd,
        es_editable: leerBandera(row, 'EsEditable', 'es_editable'),
        es_visible_default: leerBandera(
          row,
          'EsVisibleDefault',
          'es_visible_default',
        ),
        orden: row.Orden,
        sintaxis_calculo: row.SintaxisCalculo,
        regla_visibilidad: row.ReglaVisibilidad,
        regla_validacion: row.ReglaValidacion,
        // Mensajes parametrizables por pregunta: error de validación custom y
        // recordatorio para el encuestador (modal al enfocar el campo en la app).
        mensaje_error: row.MensajeError,
        mensaje_notificacion: row.MensajeNotificacion,
      });
    });

    // Queda en el log del servidor para que soporte vea QUÉ fila hay que corregir en el
    // BackOffice; antes esto era un 500 opaco y había que leer el stack trace.
    if (omitidas.length) {
      console.warn(
        `⚠️ [BACKEND] ${omitidas.length} fila(s) omitidas por datos incompletos: ${omitidas.join('; ')}`,
      );
    }

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
    const catalogos = await this.dataSource.query(
      `SELECT * FROM appEx_Catalogos_Maestro`,
    );

    catalogos.forEach((row) => {
      changes.local_catalogos.created.push({
        id: row.IdCatalogo.toString(),
        nombre_catalogo: row.NombreCatalogo,
        codigo_opcion: row.CodigoOpcion,
        valor_opcion: row.ValorOpcion,
        id_padre_opcion: row.IdPadreOpcion || null,
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
      dispositivoId,
      // GUID de la fila de pre.Precarga de la que salio esta captura. Llega SOLO
      // cuando la encuesta se abrio desde una tarjeta de cartera; las ad-hoc mandan
      // null y no tocan pre.Precarga.
      idPrecarga,
    } = payload;

    const zona = this.zonaHoraria();

    // El sistema inicia una Transacción SQL para asegurar integridad.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Usamos RAW QUERY con cláusula OUTPUT para SQL Server.
      // Esto asegura el retorno del ID sin importar si la entidad TypeORM está decorada o no.
      const resultHeader = await queryRunner.manager.query(
        `
        INSERT INTO appEx_Encabezado_Captura 
        (IdEncuesta, IdUsuario, FechaInicio, FechaFin, Latitud, Longitud, DispositivoID, IdPrecarga)
        OUTPUT inserted.IdCaptura
        VALUES (@0, @1, @2, @3, @4, @5, @6, @7)
      `,
        [
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
          dispositivoId || 'APP_OFFLINE',
          // Se normaliza a null: una cadena vacia romperia la conversion a
          // UNIQUEIDENTIFIER, mientras que null es exactamente lo que corresponde a
          // una captura ad-hoc sin origen de precarga.
          idPrecarga || null,
        ],
      );

      // Se cierra correctamente la validación de error.
      if (!resultHeader || resultHeader.length === 0) {
        throw new Error(
          'La inserción falló: SQL Server no devolvió la fila creada.',
        );
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

      console.log(
        `✅ [SQL] Encabezado creado con IdCaptura: ${idCapturaTexto}`,
      );

      // 4. Insertamos las respuestas usando el nuevoIdCaptura extraído dinámicamente
      for (const resp of respuestas) {
        console.log(
          ` [PROCESANDO RESPUESTA] Pregunta ID: ${resp.idPregunta} -> Valor enviado: "${resp.valor}"`,
        );
        await queryRunner.manager
          .createQueryBuilder()
          .insert()
          .into('appEx_Respuestas')
          .values({
            IdEncuesta: idEncuesta,
            IdPregunta: resp.idPregunta,
            UUID_Instancia: resp.uuidInstancia || null,
            Valor: resp.valor || null,
            IdCaptura: nuevoIdCaptura,
          })
          .execute();
      }

      // Cierre del ciclo de precarga: la fila de pre.Precarga de la que salio esta
      // captura pasa a 'FINALIZADO' para que el BackOffice sepa que ya se gestiono y
      // el movil deje de descargarla como pendiente (la descarga filtra estado
      // 'CARGADO'). Va en la MISMA transaccion: captura y estado se confirman juntos.
      //
      // La guarda WHERE Estado = 'CARGADO' PRESERVA revocaciones: si el BackOffice ya
      // marco ANULADO/RECHAZADO, no se pisa. @@ROWCOUNT = 0 no es error (la fila pudo
      // revocarse o no existir): la captura ya esta insertada, que es lo irrecuperable;
      // el estado es secundario y solo se registra.
      if (idPrecarga) {
        const filasPrecarga = await queryRunner.manager.query(
          `
          UPDATE pre.Precarga
             SET Estado = 'FINALIZADO', IdUsractualiza = @1, Updated_At = GETDATE()
           WHERE Id = @0 AND Estado = 'CARGADO';
          SELECT @@ROWCOUNT AS Afectadas;
        `,
          [idPrecarga, userId],
        );
        const filaConteo = filasPrecarga[0] as { Afectadas: number };
        const afectadas = Number(filaConteo?.Afectadas ?? 0);
        if (afectadas === 0) {
          console.warn(
            `[PRECARGA] La precarga ${idPrecarga} no paso a FINALIZADO (0 filas): ` +
              'ya no estaba en CARGADO (revocada/finalizada) o no existe. La captura ' +
              'se guardo igualmente.',
          );
        } else {
          console.log(`✅ [PRECARGA] ${idPrecarga} marcada FINALIZADO.`);
        }
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
      console.error(
        '❌ ERROR CRÍTICO EN SQL (submitSurvey):',
        error.message || error,
      );
      await queryRunner.rollbackTransaction();
      throw new Error(`Error BD: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Cambia el estado de una fila de pre.Precarga a RECHAZADO.
   *
   * Lo dispara el botón "Cancelar Gestión" del asesor (el cliente no quiere la
   * encuesta). La app lo encola offline y lo empuja en el sync; por eso este endpoint
   * es idempotente: un segundo intento sobre una fila ya rechazada devuelve 0 filas y
   * success igual.
   *
   * WHITELIST: la app SOLO puede RECHAZAR. FINALIZADO lo pone /submit; ANULADO lo pone
   * el BackOffice. Cualquier otro valor se rechaza para que la app no mueva la máquina
   * de estados a su antojo.
   *
   * La guarda WHERE Estado = 'CARGADO' impide pisar un FINALIZADO/ANULADO puesto
   * entretanto: solo una precarga aún pendiente puede rechazarse.
   */
  /**
   * Registra el rechazo de una gestión ("Cancelar Gestión") que el asesor hizo offline.
   *
   * Los DOS orígenes aterrizan en `appEx_Encuestas_Rechazadas`: la gestión precargada y
   * la creada en campo. La AD-HOC no existe en `pre.Precarga` —no salió de un Excel del
   * BackOffice— y antes se quedaba sin destino, así que su motivo moría en el
   * dispositivo. Cuando sí hay `idPrecarga`, el motivo se ESPEJA en esa tabla para que el
   * BackOffice lo vea donde ya mira, y su `Estado` pasa a `RECHAZADO`.
   *
   * IDEMPOTENCIA REAL, NO POR EFECTO COLATERAL
   * `idRechazo` lo genera el móvil al cancelar y es el mismo en todos los reintentos; la
   * tabla lo indexa como UNIQUE. Un 200 perdido por la red hace que el dispositivo
   * reintente, y ese reintento devuelve `DUPLICADO` en vez de insertar otro encabezado.
   * La versión anterior descansaba en que `WHERE Estado='CARGADO'` no encontrara fila la
   * segunda vez, que es un efecto colateral y no una garantía.
   *
   * POR QUÉ EL `Estado` VA EN UN `CASE` Y EL COMENTARIO NO
   * La guarda original (`WHERE Estado = 'CARGADO'`) protege un `ANULADO`/`FINALIZADO`
   * puesto entretanto por el BackOffice, y se conserva. Pero si esa guarda estuviera en
   * el `WHERE`, una fila que ya esté en `RECHAZADO` —todas las que empujó la versión
   * anterior, que mandaba el estado SIN el motivo— nunca recibiría su comentario, que es
   * justo el dato que se viene a salvar. Así que el estado se protege y el comentario
   * siempre se escribe.
   */
  async registrarEncuestaRechazada(
    userId: number,
    deviceToken: string,
    dto: EncuestaRechazadaDto,
  ) {
    const zona = this.zonaHoraria();

    /**
     * `IdEmpresa` y `DispositivoID` se resuelven AQUÍ, del dispositivo autenticado, y no
     * se aceptan del body: el equipo solo guarda `company_name` (el nombre de la empresa,
     * nunca el id), y un cliente manipulado no debe poder atribuir un rechazo a otra
     * empresa ni a otro equipo. Mismo criterio que el `userId`, que sale de la cabecera
     * verificada. Un `SELECT` cubre las dos columnas.
     */
    // `query<T>` en vez de un `as`: el genérico tipa el resultado de verdad, mientras un
    // cast sobre el `any` que devuelve el driver solo silencia al compilador.
    const dispositivo = await this.dataSource.query<
      Array<{ IdEmpresa: number | null; HardwareID: string | null }>
    >(
      `SELECT IdEmpresa, HardwareID FROM Dispositivos_AppEx WHERE DeviceToken = @0`,
      [deviceToken],
    );

    // Un dispositivo desconocido es 401, no 500: el device token ya no es válido.
    if (!dispositivo || dispositivo.length === 0) {
      throw new UnauthorizedException('Dispositivo no reconocido');
    }

    const idEmpresa = dispositivo[0].IdEmpresa ?? null;
    const dispositivoId = dispositivo[0].HardwareID ?? null;

    // Fecha del móvil solo si es creíble; si no, la del servidor. Una fecha de 1970 o de
    // 2090 desordenaría el histórico entero al consultarlo por rango.
    const fechaRechazoDisp = esFechaDispositivoRazonable(dto.fechaRechazo)
      ? aFechaLocalSqlServer(dto.fechaRechazo, zona)
      : ahoraLocalSqlServer(zona);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // El duplicado se detecta ANTES de insertar para poder responder 200 DUPLICADO en
      // vez de un 500 por violación de UNIQUE. El índice sigue siendo la garantía dura
      // (dos peticiones simultáneas), y el `catch` de abajo la traduce igual.
      const yaExiste = await queryRunner.manager.query<
        Array<{ IdEncuestaRechazada: string; AfectadasPrecarga: number }>
      >(
        `SELECT IdEncuestaRechazada, AfectadasPrecarga
           FROM appEx_Encuestas_Rechazadas WHERE IdRechazo = @0`,
        [dto.idRechazo],
      );

      if (yaExiste && yaExiste.length > 0) {
        await queryRunner.commitTransaction();
        console.log(
          `[RECHAZO] ${dto.idRechazo} ya estaba registrado: se responde DUPLICADO sin insertar.`,
        );
        return {
          success: true,
          idRechazo: dto.idRechazo,
          resultado: 'DUPLICADO' as const,
          afectadasPrecarga: Number(yaExiste[0].AfectadasPrecarga ?? 0),
        };
      }

      let afectadasPrecarga = 0;

      // El espejo va PRIMERO: si `pre.Precarga` tiene un CHECK o un trigger que lo
      // rechace, el fallo aparece antes de insertar el encabezado y el rollback deja
      // todo como estaba, en vez de dejar un encabezado que dice haber espejado algo.
      if (dto.origen === 'PRECARGA' && dto.idPrecarga) {
        const filas = await queryRunner.manager.query<
          Array<{ Afectadas: number }>
        >(
          `
          UPDATE pre.Precarga
             SET Estado = CASE WHEN Estado = 'CARGADO' THEN 'RECHAZADO' ELSE Estado END,
                 Comentario = @1,
                 IdUsractualiza = @2,
                 Updated_At = GETDATE()
           WHERE Id = @0;
          SELECT @@ROWCOUNT AS Afectadas;
        `,
          [dto.idPrecarga, dto.motivo, userId],
        );

        afectadasPrecarga = Number(filas?.[0]?.Afectadas ?? 0);

        if (afectadasPrecarga === 0) {
          // No es un error: la precarga puede haber sido revocada o finalizada. Se
          // registra el hecho y el encabezado queda igual, que es el dato que importa.
          console.warn(
            `[RECHAZO] La precarga ${dto.idPrecarga} no existe o no se pudo actualizar; ` +
              'el encabezado del rechazo se guarda de todas formas.',
          );
        }
      }

      const insertado = await queryRunner.manager.query<
        Array<{ IdEncuestaRechazada: number | string }>
      >(
        `
        INSERT INTO appEx_Encuestas_Rechazadas
          (IdRechazo, Origen, IdPrecarga, IdEmpresa, DispositivoID, IdEncuesta,
           IdUsuario, UuidInstancia, NombreCliente, Documento, Cuenta, Operacion,
           Expediente, Motivo, FechaRechazoDisp, AfectadasPrecarga)
        OUTPUT inserted.IdEncuestaRechazada
        VALUES (@0, @1, @2, @3, @4, @5, @6, @7, @8, @9, @10, @11, @12, @13, @14, @15)
      `,
        [
          dto.idRechazo,
          dto.origen,
          // Cadena vacía a null: rompería la conversión a UNIQUEIDENTIFIER, y null es
          // exactamente lo que corresponde a una gestión creada en campo.
          dto.idPrecarga || null,
          idEmpresa,
          dispositivoId,
          dto.idEncuesta,
          userId,
          dto.uuidInstancia || null,
          dto.cliente?.nombre || null,
          dto.cliente?.documento || null,
          dto.cliente?.cuenta || null,
          dto.cliente?.operacion || null,
          dto.cliente?.expediente || null,
          dto.motivo,
          fechaRechazoDisp,
          afectadasPrecarga,
        ],
      );

      if (!insertado || insertado.length === 0) {
        throw new Error(
          'La inserción del rechazo falló: SQL Server no devolvió la fila creada.',
        );
      }

      await queryRunner.commitTransaction();

      // `respuestas` se acepta en el DTO pero todavía no se persiste: queda
      // `RespuestasEnviadas = 0` para un backfill selectivo cuando se implemente.
      return {
        success: true,
        idRechazo: dto.idRechazo,
        resultado: 'REGISTRADO' as const,
        afectadasPrecarga,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();

      // Violación de UNIQUE: dos peticiones simultáneas con el mismo idRechazo. Es
      // exactamente lo que el índice debe evitar, y para el cliente es un éxito: el
      // rechazo está registrado. Devolverle un 500 lo haría reintentar sin fin.
      const mensaje = error instanceof Error ? error.message : String(error);
      const numero = (error as { number?: number })?.number;
      if (
        numero === 2601 ||
        numero === 2627 ||
        /UX_EncRech_IdRechazo/i.test(mensaje)
      ) {
        console.log(
          `[RECHAZO] Carrera sobre ${dto.idRechazo}: se responde DUPLICADO.`,
        );
        return {
          success: true,
          idRechazo: dto.idRechazo,
          resultado: 'DUPLICADO' as const,
          afectadasPrecarga: 0,
        };
      }

      console.error(
        `[RECHAZO] Falló el registro de ${dto.idRechazo}: ${mensaje}`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * @deprecated Contrato del primer intento, que mandaba el estado SIN el motivo — el
   * dato que se venía a salvar. Lo reemplaza `registrarEncuestaRechazada`, que además
   * cubre las gestiones AD-HOC. Se conserva porque puede haber APKs instalados que
   * sigan llamando a `POST /surveys/precarga-estado`: retirarlo dejaría a esos equipos
   * acumulando rechazos en su cola local sin forma de entregarlos. Retirar cuando se
   * confirme que no queda ninguno en campo.
   */
  async actualizarEstadoPrecarga(
    userId: number,
    idPrecarga: string,
    estado?: string,
  ) {
    const permitido = 'RECHAZADO';
    if ((estado || '').trim().toUpperCase() !== permitido) {
      throw new BadRequestException(
        `Estado no permitido desde la app: ${estado ?? '(vacío)'}`,
      );
    }

    const filas = await this.dataSource.query(
      `
      UPDATE pre.Precarga
         SET Estado = 'RECHAZADO', IdUsractualiza = @1, Updated_At = GETDATE()
       WHERE Id = @0 AND Estado = 'CARGADO';
      SELECT @@ROWCOUNT AS Afectadas;
    `,
      [idPrecarga, userId],
    );

    const afectadas = Number(filas?.[0]?.Afectadas ?? 0);
    if (afectadas === 0) {
      console.warn(
        `[PRECARGA] Rechazo de ${idPrecarga} no afectó filas: ya no estaba en CARGADO ` +
          '(finalizada/anulada) o no existe.',
      );
    }
    return { success: true, afectadas };
  }
}
