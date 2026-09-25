/**
 * Normalización de las fechas que envía el dispositivo — funciones puras, sin Nest
 * ni I/O, testeables con Node plano.
 *
 * EL PROBLEMA
 * La app captura con `new Date().toISOString()`: ISO-8601 en UTC con sufijo `Z`. Ese
 * string se insertaba crudo en columnas `DATETIME` de SQL Server, que no tienen zona
 * horaria: el driver descarta la `Z` y guarda la hora UTC como si fuera local. En
 * paralelo `FechaSincronizacion` la pone `DEFAULT GETDATE()`, que sí es hora local del
 * motor. Resultado: en la misma fila la sincronización salía ~6 h ANTES que el inicio.
 *
 * POR QUÉ LA PRIMERA CORRECCIÓN NO BASTÓ
 * Se convertía con los getters locales de `Date` (`getHours()`…), que devuelven la hora
 * de la zona del **proceso Node**, no la de la aplicación. En un servidor Linux con
 * TZ=UTC —lo habitual— esos getters devuelven UTC y la conversión no hacía NADA,
 * mientras `GETDATE()` seguía dando hora de Guatemala. El síntoma delata la causa: la
 * FECHA salía bien y solo la HORA estaba desplazada, porque un corrimiento de 6 h no
 * cambia el día salvo de madrugada.
 *
 * LA SOLUCIÓN
 * La zona se declara de forma EXPLÍCITA y se resuelve con `Intl`, así el resultado no
 * depende de cómo esté configurado el servidor. Node 20 incluye ICU completo, de modo
 * que las zonas IANA funcionan sin dependencias extra.
 */

/** Zona por defecto si no se configura `APP_ZONA_HORARIA`. Guatemala es UTC-6 sin horario de verano. */
export const ZONA_HORARIA_POR_DEFECTO = 'America/Guatemala';

const dosDigitos = (n: number): string => String(n).padStart(2, '0');
const tresDigitos = (n: number): string => String(n).padStart(3, '0');

/**
 * Descompone un instante en las partes de fecha/hora que corresponden a la zona
 * indicada. `Intl` es la única vía en Node estándar para hacer esto sin depender de
 * la zona del proceso ni de librerías externas.
 */
const partesEnZona = (
  fecha: Date,
  zonaHoraria: string,
): Record<string, string> => {
  const formateador = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const partes: Record<string, string> = {};
  formateador.formatToParts(fecha).forEach(({ type, value }) => {
    partes[type] = value;
  });
  return partes;
};

/**
 * Convierte una fecha ISO-8601 del dispositivo al formato que SQL Server interpreta
 * sin ambigüedad (`YYYY-MM-DD HH:mm:ss.SSS`), expresada en la zona indicada.
 *
 * Devuelve null si la entrada está vacía o no es parseable, para que el llamador
 * decida el valor por defecto en vez de insertar una fecha inventada.
 */
export function aFechaLocalSqlServer(
  isoEntrada: string | null | undefined,
  zonaHoraria: string = ZONA_HORARIA_POR_DEFECTO,
): string | null {
  if (!isoEntrada) return null;

  const fecha = new Date(isoEntrada);
  if (Number.isNaN(fecha.getTime())) return null;

  try {
    const p = partesEnZona(fecha, zonaHoraria);
    // `hourCycle` h23 puede devolver "24" a medianoche en algunos entornos.
    const hora = p.hour === '24' ? '00' : p.hour;
    const ms = tresDigitos(fecha.getUTCMilliseconds());
    return `${p.year}-${p.month}-${p.day} ${hora}:${p.minute}:${p.second}.${ms}`;
  } catch {
    // Zona horaria inválida: se degrada a UTC en vez de romper el envío de la captura.
    const iso = fecha.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}.${tresDigitos(fecha.getUTCMilliseconds())}`;
  }
}

/** Momento actual en el mismo formato y zona; fallback cuando el dispositivo no envía fecha. */
export function ahoraLocalSqlServer(
  zonaHoraria: string = ZONA_HORARIA_POR_DEFECTO,
): string {
  return aFechaLocalSqlServer(new Date().toISOString(), zonaHoraria) as string;
}

/**
 * Descarta una fecha de dispositivo que caiga fuera de un rango razonable.
 *
 * Un móvil con el reloj desajustado puede mandar una fecha de 1970 o del año 2090, y
 * una sola de esas desordena un histórico entero al consultarlo por fechas. Se devuelve
 * `null` para que el llamador use la hora del servidor: una fecha aproximada es
 * preferible a una que miente. Es la misma lección del cursor de sincronización y de la
 * bitácora de errores, que aplica esta política desde su propio dominio.
 *
 * Se mantiene aquí, y no se importa la de `diagnostics`, para no acoplar dos módulos por
 * su capa de dominio: son reglas iguales hoy que no tienen por qué evolucionar juntas.
 */
export function esFechaDispositivoRazonable(
  iso: string | null | undefined,
  ahoraMs: number = Date.now(),
): boolean {
  if (!iso) return false;

  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return false;

  const unAnio = 365 * 24 * 60 * 60 * 1000;
  const unDia = 24 * 60 * 60 * 1000;
  const ms = fecha.getTime();

  // Ni más de un año en el pasado, ni más de un día en el futuro.
  return ms >= ahoraMs - unAnio && ms <= ahoraMs + unDia;
}

/** `true` si la zona es válida para `Intl`; permite avisar al arrancar en vez de fallar en silencio. */
export function esZonaHorariaValida(zonaHoraria: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zonaHoraria });
    return true;
  } catch {
    return false;
  }
}
