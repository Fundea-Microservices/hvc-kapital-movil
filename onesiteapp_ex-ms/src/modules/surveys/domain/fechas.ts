/**
 * Normalización de las fechas que envía el dispositivo — funciones puras, sin Nest
 * ni I/O, testeables con Node plano.
 *
 * El problema que resuelve: la app captura con `new Date().toISOString()`, o sea
 * ISO-8601 en UTC con sufijo `Z` (ej. "2026-07-28T20:55:15.097Z"). Ese string se
 * insertaba CRUDO en columnas `DATETIME` de SQL Server, que no tienen zona horaria:
 * el driver descarta la `Z` y guarda la hora UTC como si fuera local. Mientras tanto
 * `FechaSincronizacion` la pone `DEFAULT GETDATE()`, que sí es hora local del
 * servidor. Resultado: en la misma fila, FechaSincronizacion salía ~6 h ANTES que
 * FechaInicio (Guatemala es UTC-6).
 *
 * La corrección se hace en un único punto —el borde del backend— convirtiendo a la
 * hora local del proceso, que es exactamente la misma referencia que usa GETDATE().
 * Así las tres columnas quedan coherentes sin tocar el tipo de las columnas.
 */

const dosDigitos = (n: number): string => String(n).padStart(2, '0');
const tresDigitos = (n: number): string => String(n).padStart(3, '0');

/**
 * Convierte una fecha ISO-8601 del dispositivo al formato que SQL Server interpreta
 * sin ambigüedad ('YYYY-MM-DD HH:mm:ss.SSS'), expresada en la zona horaria LOCAL DEL
 * SERVIDOR. Se usan los getters locales de `Date` (getHours, getMonth…), que por
 * definición devuelven hora local del proceso — la misma que GETDATE().
 *
 * Devuelve null si la entrada está vacía o no es parseable, para que el llamador
 * decida el valor por defecto en vez de insertar una fecha inventada.
 */
export function aFechaLocalSqlServer(isoEntrada: string | null | undefined): string | null {
  if (!isoEntrada) return null;

  const fecha = new Date(isoEntrada);
  if (Number.isNaN(fecha.getTime())) return null;

  const anio = fecha.getFullYear();
  const mes = dosDigitos(fecha.getMonth() + 1);
  const dia = dosDigitos(fecha.getDate());
  const hora = dosDigitos(fecha.getHours());
  const minuto = dosDigitos(fecha.getMinutes());
  const segundo = dosDigitos(fecha.getSeconds());
  const ms = tresDigitos(fecha.getMilliseconds());

  return `${anio}-${mes}-${dia} ${hora}:${minuto}:${segundo}.${ms}`;
}

/** Momento actual en el mismo formato y zona; fallback cuando el dispositivo no envía fecha. */
export function ahoraLocalSqlServer(): string {
  return aFechaLocalSqlServer(new Date().toISOString()) as string;
}
