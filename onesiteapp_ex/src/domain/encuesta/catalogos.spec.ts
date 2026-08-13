import { nombreCatalogoDe, obtenerOpciones, obtenerArbolOpciones } from './catalogos';
import type { OpcionCatalogo, PreguntaEncuesta } from './tipos';

/** Pregunta mínima; cada prueba sobrescribe lo que le importa. */
const pregunta = (parcial: Partial<PreguntaEncuesta>): PreguntaEncuesta => ({
  id: '1',
  id_seccion: 's1',
  id_matriz_padre: null,
  etiqueta: 'Pregunta',
  tipo_dato: 'SELECT',
  opciones: null,
  origen_datos_tipo: null,
  origen_datos_cmd: null,
  es_obligatorio: 0,
  orden: 1,
  sintaxis_calculo: null,
  regla_visibilidad: null,
  regla_validacion: null,
  ...parcial,
});

const opcion = (parcial: Partial<OpcionCatalogo>): OpcionCatalogo => ({
  id_remoto: null,
  nombre_catalogo: null,
  codigo_catalogo: null,
  codigo_opcion: null,
  valor_opcion: null,
  id_padre_opcion: null,
  ...parcial,
});

describe('nombreCatalogoDe', () => {
  it('para origen API usa el nombre sintetico API_<id>', () => {
    // origen_datos_cmd es la CLAVE que resuelve el backend, no un catalogo local.
    const p = pregunta({ id: '7', origen_datos_tipo: 'API', origen_datos_cmd: 'departamentos' });
    expect(nombreCatalogoDe(p)).toBe('API_7');
  });

  it('para catalogos locales usa opciones, y si falta, origen_datos_cmd', () => {
    expect(nombreCatalogoDe(pregunta({ opciones: 'CAT_PAISES' }))).toBe('CAT_PAISES');
    expect(nombreCatalogoDe(pregunta({ origen_datos_cmd: 'CAT_X' }))).toBe('CAT_X');
  });
});

describe('obtenerOpciones — listas inline', () => {
  it('acepta un arreglo JSON directo', () => {
    const p = pregunta({ opciones: '["Masculino","Femenino"]' });
    expect(obtenerOpciones(p, [], {}, [])).toEqual(['Masculino', 'Femenino']);
  });

  it('un JSON mal formado no revienta la pantalla', () => {
    const p = pregunta({ opciones: '["a", "b"' });
    expect(obtenerOpciones(p, [], {}, [])).toEqual([]);
  });

  it('separa por pipes y por comas, recortando espacios', () => {
    expect(obtenerOpciones(pregunta({ opciones: 'Si|No|Tal vez' }), [], {}, []))
      .toEqual(['Si', 'No', 'Tal vez']);
    expect(obtenerOpciones(pregunta({ opciones: ' Uno , Dos ' }), [], {}, []))
      .toEqual(['Uno', 'Dos']);
  });

  it('un valor suelto sin separadores es la unica opcion', () => {
    // Es como el BackOffice expresa un select de un solo elemento.
    expect(obtenerOpciones(pregunta({ opciones: 'Unico' }), [], {}, [])).toEqual(['Unico']);
  });

  it('sin fuente devuelve lista vacia, no null', () => {
    expect(obtenerOpciones(pregunta({}), [], {}, [])).toEqual([]);
  });
});

describe('obtenerOpciones — catalogo local', () => {
  const catalogos = [
    opcion({ id_remoto: '1', nombre_catalogo: 'CAT_Departamentos', valor_opcion: 'Guatemala' }),
    opcion({ id_remoto: '2', nombre_catalogo: 'Departamentos', valor_opcion: 'Sacatepéquez' }),
    opcion({ id_remoto: '3', nombre_catalogo: 'CAT_Municipios', valor_opcion: 'Antigua' }),
  ];

  it('ignora el prefijo cat_, los acentos y las mayusculas', () => {
    const p = pregunta({ opciones: 'CAT_DEPARTAMENTOS' });
    expect(obtenerOpciones(p, catalogos, {}, [])).toEqual(['Guatemala', 'Sacatepéquez']);
  });

  it('devuelve null cuando el catalogo no esta descargado', () => {
    // La pantalla lo traduce a "Catalogo no disponible offline"; con [] mostraria un
    // desplegable vacio y el asesor creeria que no hay opciones.
    const p = pregunta({ opciones: 'CAT_Inexistente' });
    expect(obtenerOpciones(p, catalogos, {}, [])).toBeNull();
  });
});

describe('obtenerOpciones — origen API: el bug de API_1 vs API_10', () => {
  const catalogos = [
    opcion({ id_remoto: '10', nombre_catalogo: 'API_1', valor_opcion: 'Depto A' }),
    opcion({ id_remoto: '11', nombre_catalogo: 'API_10', valor_opcion: 'Muni X' }),
    opcion({ id_remoto: '12', nombre_catalogo: 'API_100', valor_opcion: 'Aldea Z' }),
  ];

  it('API_1 NO arrastra las opciones de API_10 ni de API_100', () => {
    // Con `includes` en vez de igualdad, el select de Departamento se llenaba con
    // municipios. La comparacion es exacta SOLO para origen API a proposito.
    const p = pregunta({ id: '1', origen_datos_tipo: 'API', origen_datos_cmd: 'departamentos' });
    expect(obtenerOpciones(p, catalogos, {}, [])).toEqual(['Depto A']);
  });

  it('API_10 resuelve lo suyo, sin mezclarse con API_1', () => {
    const p = pregunta({ id: '10', origen_datos_tipo: 'API', origen_datos_cmd: 'municipios' });
    expect(obtenerOpciones(p, catalogos, {}, [])).toEqual(['Muni X']);
  });

  it('el origen API nunca se interpreta como lista inline aunque tenga comas', () => {
    const p = pregunta({ id: '1', origen_datos_tipo: 'API', origen_datos_cmd: 'a,b,c' });
    expect(obtenerOpciones(p, catalogos, {}, [])).toEqual(['Depto A']);
  });
});

describe('obtenerOpciones — cascada', () => {
  const padre = pregunta({ id: '1', opciones: 'CAT_Departamentos' });
  const hija = pregunta({
    id: '2',
    opciones: 'CAT_Municipios',
    regla_visibilidad: '{"dependeDeCatalogo":"1"}',
  });

  const catalogos = [
    opcion({ id_remoto: 'D1', nombre_catalogo: 'CAT_Departamentos', valor_opcion: 'Guatemala' }),
    opcion({ id_remoto: 'D2', nombre_catalogo: 'CAT_Departamentos', valor_opcion: 'Sacatepéquez' }),
    opcion({ id_remoto: 'M1', nombre_catalogo: 'CAT_Municipios', valor_opcion: 'Mixco', id_padre_opcion: 'D1' }),
    opcion({ id_remoto: 'M2', nombre_catalogo: 'CAT_Municipios', valor_opcion: 'Villa Nueva', id_padre_opcion: 'D1' }),
    opcion({ id_remoto: 'M3', nombre_catalogo: 'CAT_Municipios', valor_opcion: 'Antigua', id_padre_opcion: 'D2' }),
  ];

  it('sin respuesta del padre devuelve null, no el catalogo completo', () => {
    expect(obtenerOpciones(hija, catalogos, {}, [padre, hija])).toBeNull();
  });

  it('filtra los hijos por el padre elegido', () => {
    const respuestas = { '1': 'Guatemala' };
    expect(obtenerOpciones(hija, catalogos, respuestas, [padre, hija]))
      .toEqual(['Mixco', 'Villa Nueva']);
  });

  it('al cambiar el padre cambian los hijos', () => {
    const respuestas = { '1': 'Sacatepéquez' };
    expect(obtenerOpciones(hija, catalogos, respuestas, [padre, hija])).toEqual(['Antigua']);
  });

  it('en una matriz respeta la fila: cada fila filtra por SU padre', () => {
    const respuestas = { '1_filaA': 'Guatemala', '1_filaB': 'Sacatepéquez' };
    expect(obtenerOpciones(hija, catalogos, respuestas, [padre, hija], 'filaA'))
      .toEqual(['Mixco', 'Villa Nueva']);
    expect(obtenerOpciones(hija, catalogos, respuestas, [padre, hija], 'filaB'))
      .toEqual(['Antigua']);
  });

  it('resuelve al catalogo correcto cuando hay valores HOMONIMOS', () => {
    // "Guatemala" es a la vez departamento y municipio. Sin el segundo filtro por
    // catalogo del padre, la cascada podia engancharse al homonimo equivocado y
    // devolver una lista vacia o los hijos de otra cosa.
    const conHomonimo = [
      ...catalogos,
      opcion({ id_remoto: 'M9', nombre_catalogo: 'CAT_Municipios', valor_opcion: 'Guatemala', id_padre_opcion: 'D1' }),
    ];
    const respuestas = { '1': 'Guatemala' };
    expect(obtenerOpciones(hija, conHomonimo, respuestas, [padre, hija]))
      .toEqual(['Mixco', 'Villa Nueva', 'Guatemala']);
  });

  it('una regla mal formada no inutiliza la pregunta', () => {
    // Se ignora el filtro y se muestran todas las opciones, en vez de dejar al
    // asesor con un campo que no se puede llenar.
    const rota = pregunta({ id: '2', opciones: 'CAT_Municipios', regla_visibilidad: '{dependeDeCatalogo' });
    expect(obtenerOpciones(rota, catalogos, {}, [padre, rota]))
      .toEqual(['Mixco', 'Villa Nueva', 'Antigua']);
  });
});

describe('obtenerArbolOpciones', () => {
  const catalogos = [
    opcion({ id_remoto: 'P1', nombre_catalogo: 'CAT_Geo', valor_opcion: 'País' }),
    opcion({ id_remoto: 'D1', nombre_catalogo: 'CAT_Geo', valor_opcion: 'Depto', id_padre_opcion: 'P1' }),
    opcion({ id_remoto: 'M1', nombre_catalogo: 'CAT_Geo', valor_opcion: 'Muni', id_padre_opcion: 'D1' }),
  ];

  it('construye la jerarquia de tres niveles', () => {
    const p = pregunta({ opciones: 'CAT_Geo' });
    const arbol = obtenerArbolOpciones(p, catalogos, {}, []);
    expect(arbol).toEqual([
      { valor: 'País', hijos: [{ valor: 'Depto', hijos: [{ valor: 'Muni', hijos: [] }] }] },
    ]);
  });

  it('las listas inline salen planas', () => {
    const p = pregunta({ opciones: 'Si|No' });
    expect(obtenerArbolOpciones(p, [], {}, []))
      .toEqual([{ valor: 'Si', hijos: [] }, { valor: 'No', hijos: [] }]);
  });

  it('el origen API NUNCA es drill-down', () => {
    // Los "hijos" que existan en la tabla local pertenecen a OTRA pregunta: los
    // municipios cuelgan del departamento. Sin esta guarda, el select de
    // Departamento navegaba hacia dentro y terminaba guardando un municipio.
    const catalogosApi = [
      opcion({ id_remoto: 'A1', nombre_catalogo: 'API_1', valor_opcion: 'Guatemala' }),
      opcion({ id_remoto: 'A2', nombre_catalogo: 'API_2', valor_opcion: 'Mixco', id_padre_opcion: 'A1' }),
    ];
    const p = pregunta({ id: '1', origen_datos_tipo: 'API', origen_datos_cmd: 'departamentos' });
    expect(obtenerArbolOpciones(p, catalogosApi, {}, []))
      .toEqual([{ valor: 'Guatemala', hijos: [] }]);
  });

  it('una hija de cascada sale plana: ya viene filtrada a un solo padre', () => {
    const padre = pregunta({ id: '1', opciones: 'CAT_Geo' });
    const hija = pregunta({
      id: '2', opciones: 'CAT_Geo', regla_visibilidad: '{"dependeDeCatalogo":"1"}',
    });
    const arbol = obtenerArbolOpciones(hija, catalogos, { '1': 'País' }, [padre, hija]);
    expect(arbol).toEqual([{ valor: 'Depto', hijos: [] }]);
  });

  it('un catalogo CIRCULAR no cuelga la aplicacion', () => {
    // A padre de B y B padre de A: mal configurado en el BackOffice, pero posible.
    const circular = [
      opcion({ id_remoto: 'A', nombre_catalogo: 'CAT_Ciclo', valor_opcion: 'A', id_padre_opcion: 'B' }),
      opcion({ id_remoto: 'B', nombre_catalogo: 'CAT_Ciclo', valor_opcion: 'B', id_padre_opcion: 'A' }),
    ];
    const p = pregunta({ opciones: 'CAT_Ciclo' });
    const arbol = obtenerArbolOpciones(p, circular, {}, []);
    // Termina y no desborda la pila; el contenido exacto es secundario.
    expect(Array.isArray(arbol)).toBe(true);
  });

  it('propaga el null de la cascada sin responder', () => {
    const padre = pregunta({ id: '1', opciones: 'CAT_Geo' });
    const hija = pregunta({
      id: '2', opciones: 'CAT_Geo', regla_visibilidad: '{"dependeDeCatalogo":"1"}',
    });
    expect(obtenerArbolOpciones(hija, catalogos, {}, [padre, hija])).toBeNull();
  });

  it('catalogo inexistente devuelve arreglo vacio', () => {
    expect(obtenerArbolOpciones(pregunta({ opciones: 'CAT_Nada' }), catalogos, {}, [])).toEqual([]);
  });
});
