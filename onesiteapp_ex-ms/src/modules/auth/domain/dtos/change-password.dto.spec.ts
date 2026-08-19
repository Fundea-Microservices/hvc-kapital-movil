import { ChangePasswordSchema } from './change-password.dto';

/**
 * La política de contraseña es la única barrera del servidor contra credenciales
 * débiles: el móvil valida en vivo, pero un cliente manipulado o una llamada directa
 * al endpoint deben rebotar aquí. Por eso se prueba el esquema, no la UI.
 *
 * Es una prueba de dominio puro (Zod, sin BD ni DI): corre en milisegundos y no
 * depende del scaffolding de Nest.
 */

const base = {
  passwordActual: 'Temporal1!',
  passwordNueva: 'Segura2026#',
  confirmarPassword: 'Segura2026#',
};

describe('ChangePasswordSchema — caso válido', () => {
  it('acepta una contraseña que cumple las siete reglas', () => {
    expect(ChangePasswordSchema.safeParse(base).success).toBe(true);
  });
});

describe('ChangePasswordSchema — longitud', () => {
  it('rechaza menos de 8 caracteres', () => {
    // "Aa1#" (4) → 7 caracteres es el límite inferior inválido.
    const r = ChangePasswordSchema.safeParse({
      ...base,
      passwordNueva: 'Aa1#bc2',
      confirmarPassword: 'Aa1#bc2',
    });
    expect(r.success).toBe(false);
  });

  it('acepta exactamente 8 caracteres', () => {
    const r = ChangePasswordSchema.safeParse({
      ...base,
      passwordNueva: 'Aa1#bcd2',
      confirmarPassword: 'Aa1#bcd2',
    });
    expect(r.success).toBe(true);
  });

  it('acepta exactamente 20 caracteres', () => {
    const val = 'Aa1#' + 'b'.repeat(16); // 20 exactos
    const r = ChangePasswordSchema.safeParse({
      ...base,
      passwordNueva: val,
      confirmarPassword: val,
    });
    expect(r.success).toBe(true);
  });

  it('rechaza más de 20 caracteres', () => {
    const val = 'Aa1#' + 'b'.repeat(17); // 21
    const r = ChangePasswordSchema.safeParse({
      ...base,
      passwordNueva: val,
      confirmarPassword: val,
    });
    expect(r.success).toBe(false);
  });
});

describe('ChangePasswordSchema — clases de carácter', () => {
  it('rechaza si falta la mayúscula', () => {
    const r = ChangePasswordSchema.safeParse({
      ...base,
      passwordNueva: 'segura2026#',
      confirmarPassword: 'segura2026#',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza si falta la minúscula', () => {
    const r = ChangePasswordSchema.safeParse({
      ...base,
      passwordNueva: 'SEGURA2026#',
      confirmarPassword: 'SEGURA2026#',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza si falta el número', () => {
    const r = ChangePasswordSchema.safeParse({
      ...base,
      passwordNueva: 'SeguraClave#',
      confirmarPassword: 'SeguraClave#',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza si falta el carácter especial', () => {
    const r = ChangePasswordSchema.safeParse({
      ...base,
      passwordNueva: 'Segura2026',
      confirmarPassword: 'Segura2026',
    });
    expect(r.success).toBe(false);
  });
});

describe('ChangePasswordSchema — reglas de negocio', () => {
  it('rechaza cuando la confirmación no coincide', () => {
    const r = ChangePasswordSchema.safeParse({
      ...base,
      confirmarPassword: 'Otra2026#',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza cuando la nueva es idéntica a la actual', () => {
    const r = ChangePasswordSchema.safeParse({
      passwordActual: 'Segura2026#',
      passwordNueva: 'Segura2026#',
      confirmarPassword: 'Segura2026#',
    });
    expect(r.success).toBe(false);
  });
});
