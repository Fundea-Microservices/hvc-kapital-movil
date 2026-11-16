import { database } from '../database';
import CatMenu from '../models/CatMenu';
import { getMenuApi } from '../../remote/auth.api';
import { registrarError } from './bitacora.service';

const TABLA_MENU = 'cat_menu_appex';

/**
 * Descarga el menú del API de HVC Kapital y lo deja en `cat_menu_appex`.
 *
 * Reemplazo COMPLETO, no upsert: el servidor devuelve el juego entero del
 * usuario, así que una opción que ya no viene es una opción revocada y tiene
 * que desaparecer del teléfono. Son unas pocas filas.
 *
 * El id local se fuerza al GUID del servidor porque `id_padre` apunta a él:
 * con ids generados por WatermelonDB los submenús quedarían huérfanos.
 */
export const sincronizarMenu = async (token?: string): Promise<number> => {
  const opciones = await getMenuApi(token);

  const coleccion = database.collections.get<CatMenu>(TABLA_MENU);

  // Borrado y alta en DOS escrituras: WatermelonDB cachea los registros por id,
  // y recrear en el mismo bloque un id que se acaba de destruir lo hace fallar.
  await database.write(async () => {
    const existentes = await coleccion.query().fetch();
    await Promise.all(existentes.map((fila) => fila.destroyPermanently()));
  });

  await database.write(async () => {
    const lote = opciones.map((opcion) =>
      coleccion.prepareCreate((fila) => {
        // Asignación directa del id: es lo que hace el propio sync de
        // WatermelonDB al traer registros del servidor.
        (fila._raw as { id: string }).id = opcion.id;
        fila.id_padre = opcion.idPadre;
        fila.titulo = opcion.titulo || 'Sin título';
        fila.icono = opcion.icono || 'folder';
        fila.orden = opcion.orden ?? 0;
        fila.ruta_pantalla = opcion.rutaPantalla;
        // El filtro de audiencia ya ocurrió en el servidor: lo que llega es
        // visible, así que no queda ningún permiso que exigir en el móvil.
        fila.id_permiso_requerido = null;
      })
    );

    if (lote.length > 0) await database.batch(lote);
  });

  return opciones.length;
};

/**
 * Igual que `sincronizarMenu`, pero sin propagar el fallo.
 *
 * El menú es un nice-to-have frente a una visita en campo: si el API no
 * responde se conserva el que ya está en SQLite y la app sigue abriendo.
 */
export const sincronizarMenuSinFallar = async (token?: string): Promise<void> => {
  try {
    const total = await sincronizarMenu(token);
    console.log(`[MENU] ${total} opción(es) guardadas desde el API.`);
  } catch (error) {
    console.warn('[MENU] No se pudo actualizar el menú; se conserva el local.');
    void registrarError('menu.sincronizar', error).catch(() => {});
  }
};
