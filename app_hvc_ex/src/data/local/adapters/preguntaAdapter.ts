import type LocalEstructuraPregunta from '../models/LocalEstructuraPregunta';
import type { CatalogoOpcion as CatalogoOpcionModel } from '../models/CatalogoOpcion';
import { leerRaw, type RawPregunta, type RawCatalogoOpcion } from '../types/raw.types';
import type { PreguntaEncuesta, OpcionCatalogo } from '../../../domain/encuesta/tipos';

/**
 * Adaptadores entre los modelos de WatermelonDB y los contratos del dominio.
 *
 * Este es el punto donde la capa de datos "paga" para que el dominio pueda ser puro:
 * el motor de encuestas trabaja con objetos planos y por eso se prueba con Node sin
 * emulador ni mocks nativos.
 *
 * Se leen tanto la propiedad del modelo como el `_raw` subyacente porque el decorador
 * puede devolver `undefined` para columnas añadidas por migración en registros
 * antiguos. Esa doble lectura estaba repetida por toda la pantalla; aquí ocurre una
 * sola vez, en el borde.
 */

const texto = (modelo: string | null | undefined, raw: unknown): string | null => {
  const valor = modelo ?? raw;
  return valor === undefined || valor === null || valor === '' ? null : String(valor);
};

const numero = (modelo: number | null | undefined, raw: unknown, porDefecto: number): number => {
  const valor = modelo ?? raw;
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
};

/** Aplana un modelo de pregunta al contrato que consume el motor. */
export const aPreguntaEncuesta = (p: LocalEstructuraPregunta): PreguntaEncuesta => {
  const raw = leerRaw<RawPregunta>(p);
  return {
    id: String(p.id),
    id_seccion: String(p.id_seccion ?? raw.id_seccion ?? ''),
    id_matriz_padre: texto(p.id_matriz_padre, raw.id_matriz_padre),
    etiqueta: texto(p.etiqueta, raw.etiqueta) ?? 'Sin etiqueta',
    tipo_dato: texto(p.tipo_dato, raw.tipo_dato) ?? 'TEXTO',
    opciones: texto(p.opciones, raw.opciones),
    origen_datos_tipo: texto(p.origen_datos_tipo, raw.origen_datos_tipo),
    origen_datos_cmd: texto(p.origen_datos_cmd, raw.origen_datos_cmd),
    es_obligatorio: numero(p.es_obligatorio, raw.es_obligatorio, 0),
    orden: numero(p.orden, raw.orden, 0),
    sintaxis_calculo: texto(p.sintaxis_calculo, raw.sintaxis_calculo),
    regla_visibilidad: texto(p.regla_visibilidad, raw.regla_visibilidad),
    regla_validacion: texto(p.regla_validacion, raw.regla_validacion),
    mensaje_error: texto(p.mensaje_error, raw.mensaje_error),
    mensaje_notificacion: texto(p.mensaje_notificacion, raw.mensaje_notificacion),
  };
};

/** Aplana un modelo de opción de catálogo al contrato del dominio. */
export const aOpcionCatalogo = (c: CatalogoOpcionModel): OpcionCatalogo => {
  const raw = leerRaw<RawCatalogoOpcion>(c);
  return {
    id_remoto: texto(null, raw.id_remoto),
    nombre_catalogo: texto(null, raw.nombre_catalogo),
    codigo_catalogo: texto(null, raw.codigo_catalogo),
    codigo_opcion: texto(null, raw.codigo_opcion),
    valor_opcion: texto(null, raw.valor_opcion),
    id_padre_opcion: texto(null, raw.id_padre_opcion),
  };
};
