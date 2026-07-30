import {
  normalizarClaveCatalogo,
  variantesClave,
  nombresVariableUrl,
  esUrlAbsoluta,
  esRutaRelativa,
  esDependienteUrl,
  sustituirCodigoPadre,
  PLACEHOLDER_PADRE,
} from './catalogos-externos.claves';

describe('normalizarClaveCatalogo', () => {
  it.each([
    ['departamentos', 'DEPARTAMENTOS'],
    ['Departamento', 'DEPARTAMENTO'],
    [' municipios ', 'MUNICIPIOS'],
    ['MUNICIPIOS', 'MUNICIPIOS'],
    ['Región', 'REGION'],
    ['centro poblado', 'CENTRO_POBLADO'],
    ['centro-poblado', 'CENTRO_POBLADO'],
    [null, ''],
    [undefined, ''],
    ['', ''],
  ])('normaliza %p -> %p', (entrada, esperado) => {
    expect(normalizarClaveCatalogo(entrada as string | null | undefined)).toBe(esperado);
  });
});

describe('variantesClave', () => {
  it('DEPARTAMENTOS -> [DEPARTAMENTOS, DEPARTAMENTO], exacto primero', () => {
    expect(variantesClave('DEPARTAMENTOS')).toEqual(['DEPARTAMENTOS', 'DEPARTAMENTO']);
  });

  it('DEPARTAMENTO -> [DEPARTAMENTO, DEPARTAMENTOS], exacto primero', () => {
    expect(variantesClave('DEPARTAMENTO')).toEqual(['DEPARTAMENTO', 'DEPARTAMENTOS']);
  });

  it('MUNICIPIOS -> [MUNICIPIOS, MUNICIPIO]', () => {
    expect(variantesClave('MUNICIPIOS')).toEqual(['MUNICIPIOS', 'MUNICIPIO']);
  });

  it('REGION (consonante final) -> [REGION, REGIONES]', () => {
    expect(variantesClave('REGION')).toEqual(['REGION', 'REGIONES']);
  });

  it('REGIONES (plural con ES) -> [REGIONES, REGION]', () => {
    expect(variantesClave('REGIONES')).toEqual(['REGIONES', 'REGION']);
  });

  it('CENTRO_POBLADO (vocal final) -> [CENTRO_POBLADO, CENTRO_POBLADOS]', () => {
    expect(variantesClave('CENTRO_POBLADO')).toEqual(['CENTRO_POBLADO', 'CENTRO_POBLADOS']);
  });

  it('clave vacía -> []', () => {
    expect(variantesClave('')).toEqual([]);
  });

  it('nunca duplica variantes', () => {
    for (const v of variantesClave('DEPARTAMENTOS')) {
      expect(variantesClave('DEPARTAMENTOS').filter((x) => x === v)).toHaveLength(1);
    }
  });
});

describe('nombresVariableUrl', () => {
  it('municipios -> variables en el mismo orden que variantesClave', () => {
    expect(nombresVariableUrl('municipios')).toEqual([
      'API_CATALOGOS_EXT_MUNICIPIOS_URL',
      'API_CATALOGOS_EXT_MUNICIPIO_URL',
    ]);
  });

  it('Departamento -> variables en el mismo orden', () => {
    expect(nombresVariableUrl('Departamento')).toEqual([
      'API_CATALOGOS_EXT_DEPARTAMENTO_URL',
      'API_CATALOGOS_EXT_DEPARTAMENTOS_URL',
    ]);
  });

  it('clave vacía -> []', () => {
    expect(nombresVariableUrl('')).toEqual([]);
  });
});

describe('esUrlAbsoluta / esRutaRelativa', () => {
  it.each([
    ['http://172.25.5.11:3300/api/catalogos', true],
    ['https://api.example.com/x', true],
    ['/api/catalogos', false],
    ['departamentos', false],
  ])('esUrlAbsoluta(%p) === %p', (valor, esperado) => {
    expect(esUrlAbsoluta(valor)).toBe(esperado);
  });

  it.each([
    ['/api/catalogos', true],
    ['http://x', false],
    ['departamentos', false],
  ])('esRutaRelativa(%p) === %p', (valor, esperado) => {
    expect(esRutaRelativa(valor)).toBe(esperado);
  });
});

describe('esDependienteUrl', () => {
  it('detecta el placeholder {padre}', () => {
    expect(esDependienteUrl(`http://x/municipios/${PLACEHOLDER_PADRE}`)).toBe(true);
  });

  it('URL sin placeholder no es dependiente', () => {
    expect(esDependienteUrl('http://x/departamentos')).toBe(false);
  });
});

describe('sustituirCodigoPadre', () => {
  it('reemplaza todas las ocurrencias', () => {
    const url = `http://x/${PLACEHOLDER_PADRE}/y/${PLACEHOLDER_PADRE}`;
    expect(sustituirCodigoPadre(url, '11')).toBe('http://x/11/y/11');
  });

  it('codifica el código para URL', () => {
    const url = `http://x?valorCore=${PLACEHOLDER_PADRE}`;
    expect(sustituirCodigoPadre(url, 'a b/c')).toBe('http://x?valorCore=a%20b%2Fc');
  });
});
