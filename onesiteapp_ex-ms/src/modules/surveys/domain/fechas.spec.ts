import { aFechaLocalSqlServer, ahoraLocalSqlServer } from './fechas';

/**
 * Spec puro: sin Test.createTestingModule ni DataSource, así que corre en verde
 * (el resto de specs del backend son scaffolding de Nest que falla por DI).
 *
 * Requiere TZ=America/Guatemala para las aserciones de conversión — se fija en el
 * propio proceso de Jest antes de importar nada dependiente de la zona.
 */
describe('aFechaLocalSqlServer', () => {
  const tzOriginal = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/Guatemala'; // UTC-6, sin horario de verano
  });

  afterAll(() => {
    process.env.TZ = tzOriginal;
  });

  it('convierte UTC a hora local del servidor (caso real de la BD)', () => {
    // Este es el envío que produjo la fila incoherente: se guardaba 14:55 mientras
    // FechaSincronizacion decía 09:12.
    expect(aFechaLocalSqlServer('2026-07-28T14:55:15.097Z')).toBe('2026-07-28 08:55:15.097');
  });

  it('conserva milisegundos y cruza correctamente el cambio de día', () => {
    expect(aFechaLocalSqlServer('2026-07-29T02:30:00.000Z')).toBe('2026-07-28 20:30:00.000');
  });

  it('rellena con ceros meses, días y horas de un dígito', () => {
    expect(aFechaLocalSqlServer('2026-01-05T09:07:03.005Z')).toBe('2026-01-05 03:07:03.005');
  });

  it('devuelve null ante entrada vacía, nula o no parseable', () => {
    expect(aFechaLocalSqlServer('')).toBeNull();
    expect(aFechaLocalSqlServer(null)).toBeNull();
    expect(aFechaLocalSqlServer(undefined)).toBeNull();
    expect(aFechaLocalSqlServer('no-es-una-fecha')).toBeNull();
  });

  it('no aplica un segundo desplazamiento a una fecha ya sin zona', () => {
    // Un string sin 'Z' lo interpreta JS como hora local: debe salir igual, no -6h.
    expect(aFechaLocalSqlServer('2026-07-28T08:55:15.097')).toBe('2026-07-28 08:55:15.097');
  });

  it('produce un formato que SQL Server acepta sin ambigüedad', () => {
    expect(ahoraLocalSqlServer()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});
