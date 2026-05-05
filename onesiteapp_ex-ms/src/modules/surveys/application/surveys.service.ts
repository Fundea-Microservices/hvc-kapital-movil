import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SurveysService {
  constructor(private readonly dataSource: DataSource) {}

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
        titulo: row.Titulo,
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

    preguntas.forEach(row => {
      changes.local_estructura_pregunta.created.push({
        id: row.IdPregunta.toString(),
        id_seccion: row.IdSeccion.toString(),
        id_matriz_padre: row.IdMatrizPadre ? row.IdMatrizPadre.toString() : null,
        tipo_dato: row.TipoDato,
        origen_datos_tipo: row.OrigenDatosTipo,
        origen_datos_cmd: row.OrigenDatosCmd,
        es_editable: row.EsEditable ? 1 : 0,
        es_visible_default: row.EsVisibleDefault ? 1 : 0,
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
    const { idEncuesta, respuestas } = payload;
    
    // El sistema inicia una Transacción SQL para asegurar integridad.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const resp of respuestas) {
        // Se inserta cada respuesta en appEx_Respuestas
        // Nota: TypeORM para SQL Server maneja los parámetros de forma limpia enviando los valores en el array
        await queryRunner.query(
          `INSERT INTO appEx_Respuestas (IdEncuesta, IdPregunta, UUID_Instancia, Valor)
           VALUES (@0, @1, @2, @3)`,
          [
            idEncuesta, 
            resp.idPregunta, 
            resp.uuidInstancia || null, 
            resp.valor || null
          ]
        );
      }
      
      await queryRunner.commitTransaction();
      return { success: true, message: 'Encuesta sincronizada correctamente' };
      
    } catch (error: any) {
      // AQUÍ ESTÁ LA MAGIA: Imprimir el error exacto de SQL en la consola
      console.error('❌ ERROR CRÍTICO EN SQL (submitSurvey):', error.message || error);
      
      await queryRunner.rollbackTransaction();
      
      // Retornar el mensaje real al frontend para depuración (Opcional en Prod, útil en Dev)
      throw new Error(`Error BD: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }
}