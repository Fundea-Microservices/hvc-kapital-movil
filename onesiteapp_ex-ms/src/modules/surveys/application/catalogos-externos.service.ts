import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/** Fila normalizada, en la misma forma que espera local_catalogo_opciones en la app. */
export interface OpcionCatalogoExterno {
  id_remoto: string;
  nombre_catalogo: string;
  codigo_catalogo: string;
  codigo_opcion: string;
  valor_opcion: string;
  id_padre_opcion: string | null;
}

/** Placeholder que el BackOffice usa en OrigenDatosCmd para catálogos dependientes. */
const PLACEHOLDER_PADRE = '{padre}';

/**
 * Proxy de catálogos servidos por una API externa (OrigenDatosTipo = 'API' en
 * appEx_Pregunta). El token de esa API vive SOLO en el .env del servidor — nunca
 * viaja al dispositivo, a diferencia de una variable EXPO_PUBLIC_* que queda
 * embebida y extraíble del APK.
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
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async obtenerCatalogosApi(): Promise<OpcionCatalogoExterno[]> {
    const preguntas = await this.dataSource.query(`
      SELECT p.IdPregunta, p.OrigenDatosCmd, r.ReglaVisibilidad
      FROM appEx_Pregunta p
      LEFT JOIN appEx_Reglas r ON p.IdPregunta = r.IdPregunta
      WHERE LTRIM(RTRIM(UPPER(p.OrigenDatosTipo))) = 'API'
    `);

    const raiz = preguntas.filter((p: any) => !this.esDependiente(p.OrigenDatosCmd));
    const dependientes = preguntas.filter((p: any) => this.esDependiente(p.OrigenDatosCmd));

    const resultado: OpcionCatalogoExterno[] = [];
    // idPregunta -> códigos obtenidos, para resolver el placeholder de sus dependientes.
    const codigosPorPregunta = new Map<number, string[]>();

    // Fase 1: catálogos raíz (sin {padre}).
    for (const p of raiz) {
      try {
        const datos = await this.llamarApiExterna(p.OrigenDatosCmd);
        const codigos: string[] = [];
        datos.forEach((fila) => {
          const opcion = this.normalizarFilaExterna(fila);
          if (!opcion) return;
          codigos.push(opcion.codigo);
          resultado.push({
            id_remoto: opcion.codigo,
            nombre_catalogo: `API_${p.IdPregunta}`,
            codigo_catalogo: `API_${p.IdPregunta}`,
            codigo_opcion: opcion.codigo,
            valor_opcion: opcion.etiqueta,
            id_padre_opcion: null,
          });
        });
        codigosPorPregunta.set(p.IdPregunta, codigos);
      } catch (e) {
        console.warn(`[CATALOGOS-API] Falló la pregunta raíz ${p.IdPregunta}:`, e instanceof Error ? e.message : e);
      }
    }

    // Fase 2: catálogos dependientes (con {padre}), iterando por cada código del padre.
    for (const p of dependientes) {
      const idPadre = this.resolverIdPreguntaPadre(p.ReglaVisibilidad);
      if (idPadre === null) {
        console.warn(`[CATALOGOS-API] Pregunta ${p.IdPregunta} usa {padre} pero no tiene regla_visibilidad.dependeDeCatalogo; se omite.`);
        continue;
      }
      const codigosPadre = codigosPorPregunta.get(idPadre) || [];
      if (codigosPadre.length === 0) {
        console.warn(`[CATALOGOS-API] Pregunta padre ${idPadre} de ${p.IdPregunta} no tiene códigos (¿falló su llamada?); se omite.`);
        continue;
      }

      for (const codigoPadre of codigosPadre) {
        try {
          const url = p.OrigenDatosCmd.replaceAll(PLACEHOLDER_PADRE, codigoPadre);
          const datos = await this.llamarApiExterna(url);
          datos.forEach((fila) => {
            const opcion = this.normalizarFilaExterna(fila);
            if (!opcion) return;
            resultado.push({
              id_remoto: opcion.codigo,
              nombre_catalogo: `API_${p.IdPregunta}`,
              codigo_catalogo: `API_${p.IdPregunta}`,
              codigo_opcion: opcion.codigo,
              valor_opcion: opcion.etiqueta,
              id_padre_opcion: codigoPadre,
            });
          });
        } catch (e) {
          console.warn(`[CATALOGOS-API] Falló ${p.IdPregunta} para padre=${codigoPadre}:`, e instanceof Error ? e.message : e);
        }
      }
    }

    return resultado;
  }

  private esDependiente(origenDatosCmd: string | null): boolean {
    return typeof origenDatosCmd === 'string' && origenDatosCmd.includes(PLACEHOLDER_PADRE);
  }

  /** Lee `{"dependeDeCatalogo": n}` de regla_visibilidad; null si no aplica o es inválida. */
  private resolverIdPreguntaPadre(reglaVisibilidad: string | null): number | null {
    if (!reglaVisibilidad) return null;
    try {
      const regla = JSON.parse(reglaVisibilidad);
      const id = Number(regla?.dependeDeCatalogo);
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }

  /**
   * Llama a la API externa con el esquema de auth configurado por .env y
   * devuelve el arreglo de filas, tolerando que la respuesta venga envuelta en
   * { data: [...] } o { resultado: [...] } además de un arreglo plano.
   */
  private async llamarApiExterna(rutaOClave: string): Promise<unknown[]> {
    const base = this.configService.get<string>('API_CATALOGOS_EXT_URL', '');
    const url = rutaOClave.startsWith('http') ? rutaOClave : `${base}${rutaOClave}`;

    const token = this.configService.get<string>('API_CATALOGOS_EXT_TOKEN', '');
    const headerAuth = this.configService.get<string>('API_CATALOGOS_EXT_AUTH_HEADER', 'Authorization');
    const prefijoAuth = this.configService.get<string>('API_CATALOGOS_EXT_AUTH_PREFIJO', 'Bearer');

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers[headerAuth] = prefijoAuth ? `${prefijoAuth} ${token}` : token;
    }

    const respuesta = await fetch(url, { headers });
    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status} en ${url}`);
    }
    const cuerpo: unknown = await respuesta.json();

    // DIAGNÓSTICO TEMPORAL: formato real de la API externa aún no confirmado.
    // Retirar una vez validado el normalizador contra datos reales.
    console.log(`🔎 [DIAGNOSTICO API-EXT] ${url} ->`, JSON.stringify(cuerpo).slice(0, 500));

    const filas = this.extraerFilas(cuerpo);
    if (filas.length === 0) {
      console.warn(`[CATALOGOS-API] Respuesta de ${url} no es un arreglo reconocible; se omite.`);
    }
    return filas;
  }

  /**
   * Desenvuelve la respuesta cruda a un arreglo de filas, tolerando las envolturas
   * comunes ({data: [...]}, {resultado: [...]}, {items: [...]}) y el caso real
   * observado en la API de catálogos: {data: {catalogos: [...]}}, donde cada
   * elemento es un nodo raíz (ej. el país) cuyas opciones reales están en su
   * propio arreglo `hijos`/`children` (ej. los departamentos). Solo se toma UN
   * nivel de `hijos` — un nivel más profundo (ej. municipios anidados dentro de
   * cada departamento) se ignora aquí a propósito: esa relación la resuelve la
   * fase 2 ({padre}) con la pregunta hija correspondiente, para no mezclar dos
   * catálogos distintos bajo el mismo nombre sintético "API_<IdPregunta>".
   */
  private extraerFilas(cuerpo: unknown): unknown[] {
    if (Array.isArray(cuerpo)) return cuerpo;
    if (!cuerpo || typeof cuerpo !== 'object') return [];

    const obj = cuerpo as Record<string, unknown>;
    const candidatos = [obj.data, obj.resultado, obj.items];
    for (const candidato of candidatos) {
      if (Array.isArray(candidato)) return candidato;
    }
    if (obj.data && typeof obj.data === 'object') {
      const dataObj = obj.data as Record<string, unknown>;
      const anidados = [dataObj.catalogos, dataObj.resultado, dataObj.items];
      for (const candidato of anidados) {
        if (Array.isArray(candidato)) return this.desenvolverHijos(candidato);
      }
    }
    return [];
  }

  /** Si los nodos son raíces envolventes con `hijos`/`children`, devuelve ese nivel; si no, los nodos tal cual. */
  private desenvolverHijos(nodos: unknown[]): unknown[] {
    if (nodos.length === 0) return nodos;
    const primero = nodos[0];
    if (typeof primero !== 'object' || primero === null) return nodos;
    const f = primero as Record<string, unknown>;
    const hijos = Array.isArray(f.hijos) ? f.hijos : Array.isArray(f.children) ? f.children : null;
    if (hijos === null) return nodos;
    // Une los hijos de TODOS los nodos raíz (normalmente hay uno solo, ej. el país).
    return nodos.flatMap((n) => {
      if (typeof n !== 'object' || n === null) return [];
      const nf = n as Record<string, unknown>;
      if (Array.isArray(nf.hijos)) return nf.hijos;
      if (Array.isArray(nf.children)) return nf.children;
      return [];
    });
  }

  /**
   * Normaliza una fila de la API externa admitiendo variantes comunes de
   * nombre de campo, ya que el formato exacto no está confirmado todavía.
   */
  private normalizarFilaExterna(fila: unknown): { codigo: string; etiqueta: string } | null {
    if (typeof fila !== 'object' || fila === null) return null;
    const f = fila as Record<string, unknown>;

    const codigo = f.codigo ?? f.id ?? f.valorCore ?? f.value ?? f.clave ?? f.codigoOpcion;
    const etiqueta = f.nombre ?? f.descripcion ?? f.valor ?? f.label ?? f.text ?? f.nombreCorto;

    if (codigo === undefined || codigo === null || etiqueta === undefined || etiqueta === null) {
      return null;
    }
    return { codigo: String(codigo), etiqueta: String(etiqueta) };
  }
}
