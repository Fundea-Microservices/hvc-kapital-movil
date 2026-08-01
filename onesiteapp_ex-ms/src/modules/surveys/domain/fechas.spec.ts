import { aFechaLocalSqlServer, ahoraLocalSqlServer, esZonaHorariaValida } from './fechas';

/**
 * Spec puro: sin Test.createTestingModule ni DataSource, así que corre en verde
 * (el resto de specs del backend son scaffolding de Nest que falla por DI).
 *
 * La prueba MÁS importante de este archivo es la del bloque "independiente de la zona
 * del servidor": la primera corrección usaba los getters locales de `Date` y por eso
 * no hacía nada en un servidor con TZ=UTC. Estas aserciones fallarían con aquella
 * implementación.
 */
describe('aFechaLocalSqlServer', () => {
  const GT = 'America/Guatemala'; // UTC-6, sin horario de verano

  it('convierte UTC a la zona indicada (caso real de la BD)', () => {
    // Este envío produjo la fila incoherente: se guardaba 14:55 mientras
    // FechaSincronizacion decía 09:12.
    expect(aFechaLocalSqlServer('2026-07-28T14:55:15.097Z', GT)).toBe('2026-07-28 08:55:15.097');
  });

  it('conserva milisegundos y cruza correctamente el cambio de día', () => {
    expect(aFechaLocalSqlServer('2026-07-29T02:30:00.000Z', GT)).toBe('2026-07-28 20:30:00.000');
  });

  it('rellena con ceros meses, días y horas de un dígito', () => {
    expect(aFechaLocalSqlServer('2026-01-05T09:07:03.005Z', GT)).toBe('2026-01-05 03:07:03.005');
  });

  it('maneja la medianoche exacta sin devolver la hora 24', () => {
    expect(aFechaLocalSqlServer('2026-07-30T06:00:00.000Z', GT)).toBe('2026-07-30 00:00:00.000');
  });

  describe('independiente de la zona horaria del SERVIDOR', () => {
    // La causa raíz del bug "la fecha llega bien pero la hora no": los getters locales
    // de Date devuelven la zona del PROCESO. En un servidor Linux con TZ=UTC no
    // convertían nada, mientras GETDATE() de SQL Server sí daba hora local.
    const tzOriginal = process.env.TZ;
    afterEach(() => { process.env.TZ = tzOriginal; });

    it.each(['UTC', 'America/Guatemala', 'Europe/Madrid', 'Asia/Tokyo'])(
      'da el mismo resultado con el proceso en %s',
      (tzServidor) => {
        process.env.TZ = tzServidor;
        expect(aFechaLocalSqlServer('2026-07-30T20:15:00.000Z', GT)).toBe('2026-07-30 14:15:00.000');
      },
    );
  });

  it('acepta otras zonas, para despliegues fuera de Guatemala', () => {
    expect(aFechaLocalSqlServer('2026-07-30T20:15:00.000Z', 'UTC')).toBe('2026-07-30 20:15:00.000');
    expect(aFechaLocalSqlServer('2026-07-30T20:15:00.000Z', 'America/Bogota')).toBe('2026-07-30 15:15:00.000');
  });

  it('devuelve null ante entrada vacía, nula o no parseable', () => {
    expect(aFechaLocalSqlServer('')).toBeNull();
    expect(aFechaLocalSqlServer(null)).toBeNull();
    expect(aFechaLocalSqlServer(undefined)).toBeNull();
    expect(aFechaLocalSqlServer('no-es-una-fecha')).toBeNull();
  });

  it('ante una zona invalida degrada a UTC en vez de romper el envio', () => {
    // Perder una captura de campo por un .env mal escrito seria mucho peor.
    const resultado = aFechaLocalSqlServer('2026-07-30T20:15:00.000Z', 'Zona/Inventada');
    expect(resultado).toBe('2026-07-30 20:15:00.000');
  });

  it('produce un formato que SQL Server acepta sin ambigüedad', () => {
    expect(ahoraLocalSqlServer(GT)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});

describe('esZonaHorariaValida', () => {
  it('distingue zonas reales de inventadas', () => {
    expect(esZonaHorariaValida('America/Guatemala')).toBe(true);
    expect(esZonaHorariaValida('UTC')).toBe(true);
    expect(esZonaHorariaValida('Zona/Inventada')).toBe(false);
  });
});
