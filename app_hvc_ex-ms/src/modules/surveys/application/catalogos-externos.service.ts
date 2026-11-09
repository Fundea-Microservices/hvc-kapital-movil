import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  esDependienteUrl,
  esRutaRelativa,
  esUrlAbsoluta,
  nombresVariableUrl,
  sustituirCodigoPadre,
} from '../domain/catalogos-externos.claves';
import {
  MapeoRespuestaExterna,
  OpcionExterna,
  mapeoDesdeEntorno,
  normalizarRespuesta,
} from '../domain/catalogos-externos.mapeo';

/** Fila normalizada, en la misma forma que espera local_catalogo_opciones en la app. */
export interface OpcionCatalogoExterno {
  id_remoto: string;
  nombre_catalogo: string;
  codigo_catalogo: string;
  codigo_opcion: string;
  valor_opcion: string;
  id_padre_opcion: string | null;
}

interface FilaPregunta {
  IdPregunta: number;
  OrigenDatosCmd: string | null;
  ReglaVisibilidad: string | null;
}

type ResolucionOrigen =
  | { tipo: 'url'; url: string; variable: string | null; legado: boolean }
  | { tipo: 'sin-resolver'; clave: string; variablesProbadas: string[] };

interface PlanCatalogo {
  idPregunta: number;
  url: string;
  esDependiente: boolean;
  reglaVisibilidad: string | null;
}

/**
 * Proxy de catálogos servidos por una API externa (OrigenDatosTipo = 'API' en
 * appEx_Pregunta). El token de esa API vive SOLO en el .env del servidor — nunca
 * viaja al dispositivo, a diferencia de una variable EXPO_PUBLIC_* que queda
 * embebida y extraíble del APK.
 *
 * `OrigenDatosCmd` es una CLAVE corta (ej. "departamentos", "Municipio"), NO una
 * URL: la URL real vive en el .env bajo `API_CATALOGOS_EXT_<CLAVE>_URL` (ver
 * `resolverOrigen`). Se conserva compatibilidad con una URL completa como
 * fallback legado, con warn de deprecación.
 *
 * Los resultados se normalizan a la MISMA forma que un catálogo maestro local
 * (local_catalogo_opciones), con nombre_catalogo = "API_<IdPregunta>", para que
 * la app los guarde y consuma con el motor de cascada (id_padre_opcion) que ya
 * existe — sin tocar esa lógica.
 *
 * Catálogos dependientes (URL con {padre}, ej. municipios por departamento) se
 * resuelven en dos fases: primero las preguntas raíz, luego las que declaran
 * regla_visibilidad = {"dependeDeCatalogo": <idPreguntaPadre>}, iterando el
 * placeholder por cada código ya obtenido del padre. No se soportan cadenas de
 * 3+ niveles vía API en esta iteración (el caso real es Departamento→Municipio).
 */
@Injectable()
export class CatalogosExternosService {
  private readonly logger = new Logger(CatalogosExternosService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async obtenerCatalogosApi(): Promise<OpcionCatalogoExterno[]> {
    const filas: FilaPregunta[] = await this.dataSource.query(`
      SELECT p.IdPregunta, p.OrigenDatosCmd, r.ReglaVisibilidad
      FROM appEx_Pregunta p
      LEFT JOIN appEx_Reglas r ON p.IdPregunta = r.IdPregunta
      WHERE LTRIM(RTRIM(UPPER(p.OrigenDatosTipo))) = 'API'
    `);

    // Cero preguntas es un fallo MUDO: sin este aviso el endpoint devuelve []
    // sin ninguna pista de que el problema está en la configuración del BackOffice
    // (OrigenDatosTipo distinto de 'API') y no en la API externa.
    if (filas.length === 0) {
      this.logger.warn(
        "No hay preguntas con OrigenDatosTipo = 'API' en appEx_Pregunta. " +
          'Revise que la columna diga exactamente API (se ignoran mayúsculas y espacios).',
      );
      return [];
    }

    const mapeo = this.mapeo();
    const plan = this.construirPlan(filas);
    const raiz = plan.filter((p) => !p.esDependiente);
    const dependientes = plan.filter((p) => p.esDependiente);

    if (this.diagnosticoActivo()) {
      this.logger.debug(
        `Preguntas API encontradas: ${filas.length} -> ` +
          filas
            .map((f) => `#${f.IdPregunta} cmd="${f.OrigenDatosCmd ?? ''}"`)
            .join(' | '),
      );
      this.logger.debug(
        `Plan: ${plan.length} (raíz=${raiz.length}, dependientes=${dependientes.length}) -> ` +
          plan
            .map(
              (p) =>
                `#${p.idPregunta} ${p.esDependiente ? 'DEP' : 'RAIZ'} ${p.url}`,
            )
            .join(' | '),
      );
    }

    const resultado: OpcionCatalogoExterno[] = [];
    // idPregunta -> códigos obtenidos, para resolver el placeholder de sus dependientes.
    const codigosPorPregunta = new Map<number, string[]>();

    // Fase 1: catálogos raíz (sin {padre}).
    for (const p of raiz) {
      try {
        const opciones = await this.llamarApiExterna(p.url, mapeo);
        codigosPorPregunta.set(
          p.idPregunta,
          opciones.map((o) => o.codigo),
        );
        for (const opcion of opciones) {
          resultado.push(this.aOpcionCatalogo(p.idPregunta, opcion, null));
        }
        // Una respuesta 200 que no produce opciones apunta al MAPEO (ruta de datos o
        // nombres de campo), no a la conectividad: sin este aviso es indistinguible
        // de una llamada que nunca se hizo.
        if (opciones.length === 0) {
          this.logger.warn(
            `Pregunta raíz ${p.idPregunta}: la API respondió pero no se extrajo ninguna opción. ` +
              `Revise API_CATALOGOS_EXT_RUTA_DATOS / _CLAVES_HIJOS / _CAMPOS_CODIGO / _CAMPOS_ETIQUETA. URL: ${p.url}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `Falló la pregunta raíz ${p.idPregunta}: ${this.mensajeError(e)}`,
        );
      }
    }

    // Fase 2: catálogos dependientes (con {padre}), iterando por cada código del padre.
    for (const p of dependientes) {
      const idPadre = this.resolverIdPreguntaPadre(p.reglaVisibilidad);
      if (idPadre === null) {
        this.logger.warn(
          `Pregunta ${p.idPregunta} usa {padre} pero no tiene regla_visibilidad.dependeDeCatalogo; se omite.`,
        );
        continue;
      }
      const codigosPadre = codigosPorPregunta.get(idPadre) || [];
      if (codigosPadre.length === 0) {
        this.logger.warn(
          `Pregunta padre ${idPadre} de ${p.idPregunta} no tiene códigos (¿falló su llamada?); se omite.`,
        );
        continue;
      }

      const concurrencia = this.numeroEntorno(
        'API_CATALOGOS_EXT_CONCURRENCIA',
        4,
      );
      for (let i = 0; i < codigosPadre.length; i += concurrencia) {
        const lote = codigosPadre.slice(i, i + concurrencia);
        const resultadosLote = await Promise.all(
          lote.map(async (codigoPadre) => {
            try {
              const url = sustituirCodigoPadre(p.url, codigoPadre);
              const opciones = await this.llamarApiExterna(url, mapeo);
              return { codigoPadre, opciones };
            } catch (e) {
              this.logger.warn(
                `Falló ${p.idPregunta} para padre=${codigoPadre}: ${this.mensajeError(e)}`,
              );
              return { codigoPadre, opciones: [] as OpcionExterna[] };
            }
          }),
        );
        for (const { codigoPadre, opciones } of resultadosLote) {
          for (const opcion of opciones) {
            resultado.push(
              this.aOpcionCatalogo(p.idPregunta, opcion, codigoPadre),
            );
          }
        }
      }
    }

    const porPregunta = new Map<number, number>();
    for (const fila of resultado) {
      const id = Number(fila.nombre_catalogo.replace('API_', ''));
      porPregunta.set(id, (porPregunta.get(id) ?? 0) + 1);
    }
    this.logger.log(
      `Catálogos API: ${resultado.length} opciones de ${porPregunta.size} pregunta(s) ` +
        `[${[...porPregunta.entries()].map(([id, n]) => `#${id}:${n}`).join(', ') || 'ninguna'}]`,
    );

    return resultado;
  }

  private diagnosticoActivo(): boolean {
    return (
      this.configService
        .get<string>('API_CATALOGOS_EXT_DIAGNOSTICO', 'false')
        .toLowerCase() === 'true'
    );
  }

  private aOpcionCatalogo(
    idPregunta: number,
    opcion: OpcionExterna,
    idPadreOpcion: string | null,
  ): OpcionCatalogoExterno {
    return {
      id_remoto: opcion.codigo,
      nombre_catalogo: `API_${idPregunta}`,
      codigo_catalogo: `API_${idPregunta}`,
      codigo_opcion: opcion.codigo,
      valor_opcion: opcion.etiqueta,
      id_padre_opcion: idPadreOpcion,
    };
  }

  /**
   * Resuelve la URL de cada pregunta ANTES de particionar raíz/dependientes:
   * la detección de {padre} se hace sobre la URL ya resuelta, no sobre la
   * clave cruda. Una clave que no resuelve a ninguna variable de entorno se
   * registra con detalle (qué variables se probaron) y se omite del plan —
   * nunca entra a ninguna fase, preservando la falla aislada.
   */
  private construirPlan(filas: FilaPregunta[]): PlanCatalogo[] {
    const plan: PlanCatalogo[] = [];
    for (const fila of filas) {
      const resolucion = this.resolverOrigen(fila.OrigenDatosCmd);
      if (resolucion.tipo === 'sin-resolver') {
        if (resolucion.clave) {
          this.logger.warn(
            `Pregunta ${fila.IdPregunta}: clave "${resolucion.clave}" sin URL configurada. ` +
              `Defina una de: ${resolucion.variablesProbadas.join(', ')}`,
          );
        }
        continue;
      }
      if (resolucion.legado) {
        this.logger.warn(
          `Pregunta ${fila.IdPregunta}: OrigenDatosCmd trae una URL completa (formato obsoleto). ` +
            `Use una clave corta y configure API_CATALOGOS_EXT_<CLAVE>_URL en su lugar.`,
        );
      }
      plan.push({
        idPregunta: fila.IdPregunta,
        url: resolucion.url,
        esDependiente: esDependienteUrl(resolucion.url),
        reglaVisibilidad: fila.ReglaVisibilidad,
      });
    }
    return plan;
  }

  /**
   * Precedencia: (1) vacío -> sin-resolver; (2) URL absoluta -> legado, se usa
   * tal cual con warn de deprecación; (3) ruta relativa -> se concatena a
   * API_CATALOGOS_EXT_URL (comportamiento previo, para no romper configuraciones
   * existentes); (4) clave -> primera variable API_CATALOGOS_EXT_<CLAVE>_URL que
   * exista; (5) ninguna variable existe -> sin-resolver, con el detalle de qué
   * se probó.
   */
  private resolverOrigen(origenDatosCmd: string | null): ResolucionOrigen {
    const valor = (origenDatosCmd ?? '').trim();
    if (!valor)
      return { tipo: 'sin-resolver', clave: '', variablesProbadas: [] };

    if (esUrlAbsoluta(valor)) {
      return { tipo: 'url', url: valor, variable: null, legado: true };
    }

    if (esRutaRelativa(valor)) {
      const base = this.configService.get<string>('API_CATALOGOS_EXT_URL', '');
      return {
        tipo: 'url',
        url: `${base}${valor}`,
        variable: 'API_CATALOGOS_EXT_URL',
        legado: false,
      };
    }

    const variables = nombresVariableUrl(valor);
    for (const variable of variables) {
      const url = this.configService.get<string>(variable);
      if (url) return { tipo: 'url', url, variable, legado: false };
    }
    return { tipo: 'sin-resolver', clave: valor, variablesProbadas: variables };
  }

  /**
   * Lee `{"dependeDeCatalogo": n}` de regla_visibilidad; null si no aplica o es inválida.
   * El BackOffice a veces escribe el token Qn SIN comillas (`{"dependeDeCatalogo": Q10}`),
   * lo cual no es JSON válido — se sanea antes de parsear y se acepta tanto el token
   * como un id numérico crudo.
   */
  private resolverIdPreguntaPadre(
    reglaVisibilidad: string | null,
  ): number | null {
    if (!reglaVisibilidad) return null;
    try {
      const saneada = reglaVisibilidad.replace(/:(\s*)Q(\d+)\b/gi, ':$1"Q$2"');
      const regla = JSON.parse(saneada);
      const crudo = String(regla?.dependeDeCatalogo ?? '');
      const tokenQ = crudo.match(/^Q(\d+)$/i);
      const id = Number(tokenQ ? tokenQ[1] : crudo);
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }

  /**
   * Llama a la API externa con el esquema de auth y el timeout configurados,
   * reintenta solo fallos de red/timeout (nunca 4xx) y devuelve las opciones ya
   * normalizadas según el mapeo activo.
   */
  private async llamarApiExterna(
    url: string,
    mapeo: MapeoRespuestaExterna,
  ): Promise<OpcionExterna[]> {
    const token = this.configService.get<string>('API_CATALOGOS_EXT_TOKEN', '');
    const headerAuth = this.configService.get<string>(
      'API_CATALOGOS_EXT_AUTH_HEADER',
      'Authorization',
    );
    const prefijoAuth = this.configService.get<string>(
      'API_CATALOGOS_EXT_AUTH_PREFIJO',
      'Bearer',
    );
    const timeoutMs = this.numeroEntorno('API_CATALOGOS_EXT_TIMEOUT_MS', 8000);
    const reintentos = this.numeroEntorno('API_CATALOGOS_EXT_REINTENTOS', 1);
    const diagnostico = this.diagnosticoActivo();

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers[headerAuth] = prefijoAuth ? `${prefijoAuth} ${token}` : token;
    }

    let ultimoError: unknown;
    for (let intento = 0; intento <= reintentos; intento += 1) {
      try {
        const respuesta = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!respuesta.ok) {
          throw new Error(`HTTP ${respuesta.status} en ${url}`);
        }
        const cuerpo: unknown = await respuesta.json();

        if (diagnostico) {
          this.logger.debug(
            `${url} -> ${JSON.stringify(cuerpo).slice(0, 500)}`,
          );
        }

        return normalizarRespuesta(cuerpo, mapeo);
      } catch (e) {
        ultimoError = this.esTimeout(e)
          ? new Error(`Timeout de ${timeoutMs}ms en ${url}`)
          : e;
        // Los 4xx no mejoran reintentando; el resto (red/timeout) sí.
        if (e instanceof Error && /^HTTP 4\d\d/.test(e.message)) break;
        if (intento < reintentos) await this.esperar(300);
      }
    }
    throw ultimoError instanceof Error
      ? ultimoError
      : new Error(String(ultimoError));
  }

  private esTimeout(e: unknown): boolean {
    return (
      e instanceof Error &&
      (e.name === 'TimeoutError' || e.name === 'AbortError')
    );
  }

  private esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mensajeError(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  private numeroEntorno(clave: string, porDefecto: number): number {
    const crudo = this.configService.get<string>(clave, String(porDefecto));
    const numero = Number(crudo);
    return Number.isFinite(numero) && numero > 0 ? numero : porDefecto;
  }

  private mapeo(): MapeoRespuestaExterna {
    return mapeoDesdeEntorno((clave) => this.configService.get<string>(clave));
  }
}
