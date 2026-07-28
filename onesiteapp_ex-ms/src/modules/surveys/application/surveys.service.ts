import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

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
  constructor(private readonly dataSource: DataSource) { }

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

    // DIAGNÓSTICO TEMPORAL: revela el nombre EXACTO de columnas en la BD real del
    // BackOffice (no es consultable desde este entorno). Retirar una vez confirmado
    // que EsObligatorio (u otro alias ya soportado) trae el valor correcto.
    if (preguntas.length > 0) {
      console.log('🔎 [DIAGNOSTICO] Columnas de appEx_Pregunta:', Object.keys(preguntas[0]));
      console.log('🔎 [DIAGNOSTICO] Primera fila (obligatorio/editable/visible):', {
        EsObligatorio: preguntas[0].EsObligatorio,
        Obligatorio: preguntas[0].Obligatorio,
        EsRequerido: preguntas[0].EsRequerido,
        Requerido: preguntas[0].Requerido,
        EsEditable: preguntas[0].EsEditable,
        EsVisibleDefault: preguntas[0].EsVisibleDefault,
      });
    }

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
        OUTPUT inserted.*
        VALUES (@0, @1, @2, @3, @4, @5, @6)
      `, [
        idEncuesta,
        userId,
        fechaInicio || new Date().toISOString(),
        fechaFin || new Date().toISOString(),
        latitud || null,
        longitud || null,
        dispositivoId || 'APP_OFFLINE'
      ]);

      // Se cierra correctamente la validación de error.
      if (!resultHeader || resultHeader.length === 0) {
        throw new Error("La inserción falló: SQL Server no devolvió la fila creada.");
      } 
      // EL CÓDIGO CONTINÚA NORMALMENTE SI PASÓ LA VALIDACIÓN

      // MAGIA DINÁMICA: Tomamos la primera fila devuelta
      const filaCreada = resultHeader[0];

      // Extraemos todas las llaves (nombres de las columnas) de esa fila
      const nombresColumnas = Object.keys(filaCreada);

      // Asumimos que la Llave Primaria (Id) es siempre la primera columna de la tabla
      const nombreDeLaLlavePrimaria = nombresColumnas[0];

      // Extraemos el valor real del ID
      const nuevoIdCaptura = filaCreada[nombreDeLaLlavePrimaria];

      console.log(`✅ [SQL] Encabezado creado con ID: ${nuevoIdCaptura} (Columna: ${nombreDeLaLlavePrimaria})`);

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
      return { success: true, message: 'Encuesta sincronizada correctamente' };

    } catch (error: any) {
      console.error('❌ ERROR CRÍTICO EN SQL (submitSurvey):', error.message || error);
      await queryRunner.rollbackTransaction();
      throw new Error(`Error BD: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }
}