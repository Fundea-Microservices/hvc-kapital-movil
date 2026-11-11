import { normalizarComparacion } from '../encuesta/tipos';

/**
 * Filtrado y ordenación de la agenda. Puro: se prueba sin emulador.
 */

/** Lo mínimo que la búsqueda necesita de una fila; el modelo de WatermelonDB encaja. */
export interface ClienteBuscable {
  nombre: string;
  estado_gestion: number;
  busqueda_normalizada: string | null;
  documento: string | null;
  cuenta: string | null;
  operacion: string | null;
}

/** 0 = Pendiente, 1 = Gestionado/Completado, 2 = Cancelado. */
export const GESTION = { PENDIENTE: 0, COMPLETADO: 1, CANCELADO: 2 } as const;

/**
 * Pajar de una fila.
 *
 * `busqueda_normalizada` se calcula al sincronizar, pero las filas AD-HOC creadas en
 * campo y las que vienen de una base v9 migrada la tienen a `null`. En ese caso se
 * compone al vuelo con lo que haya, para que un cliente creado en campo también se
 * pueda buscar por su nombre en vez de desaparecer del filtro.
 */
const pajarDe = (cliente: ClienteBuscable): string =>
  cliente.busqueda_normalizada && cliente.busqueda_normalizada !== ''
    ? cliente.busqueda_normalizada
    : [cliente.documento, cliente.nombre, cliente.cuenta, cliente.operacion]
        .map((c) => normalizarComparacion(c))
        .filter((c) => c !== '')
        .join(' ');

/**
 * Filtra por la consulta y ordena pendientes primero, luego alfabéticamente.
 *
 * Los términos se separan por espacios y se exigen TODOS (semántica AND), de modo que
 * "coc maria" encuentra a "María Elena Coc" en cualquier orden. La consulta se normaliza
 * con el mismo helper que el pajar: sin acentos en ambos lados, "maria" encuentra
 * "María" y al revés.
 *
 * No muta la lista recibida — WatermelonDB reutiliza el array del observable y
 * ordenarlo en sitio corrompería la caché de la colección.
 */
export const filtrarClientes = <T extends ClienteBuscable>(
  clientes: readonly T[],
  consulta: string,
): T[] => {
  // Se separa por espacio simple y se descartan los vacíos: eso cubre los espacios
  // repetidos sin necesidad de una expresión regular.
  const terminos = normalizarComparacion(consulta).split(' ').filter((t) => t !== '');

  const filtrados =
    terminos.length === 0
      ? clientes.slice()
      : clientes.filter((cliente) => {
          const pajar = pajarDe(cliente);
          return terminos.every((termino) => pajar.includes(termino));
        });

  return filtrados.sort((a, b) => {
    if (a.estado_gestion !== b.estado_gestion) return a.estado_gestion - b.estado_gestion;
    return normalizarComparacion(a.nombre).localeCompare(normalizarComparacion(b.nombre));
  });
};

/** Cuántas filas siguen pendientes de gestionar. */
export const contarPendientes = (clientes: readonly ClienteBuscable[]): number =>
  clientes.reduce((total, c) => (c.estado_gestion === GESTION.PENDIENTE ? total + 1 : total), 0);

/**
 * Solo las tarjetas que al asesor le queda trabajo por hacer.
 *
 * Las completadas se OCULTAN, no se borran. Borrar la fila de una precarga completada
 * sería contraproducente: el servicio la sigue devolviendo hasta que BackOffice la
 * marque como APLICADO, así que el siguiente "Cargar datos" la recrearía desde cero
 * —con `estado_gestion = 0`— y el asesor volvería a ver como pendiente una encuesta
 * que ya hizo. Conservando la fila, el upsert la reconoce por `id_cliente` y respeta
 * su estado, que es del asesor.
 */
export const soloPendientes = <T extends ClienteBuscable>(clientes: readonly T[]): T[] =>
  clientes.filter((c) => c.estado_gestion === GESTION.PENDIENTE);
