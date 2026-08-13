/**
 * Simulaciones para las pruebas de integración de la capa de datos.
 *
 * Solo se simula lo que NO se puede ejecutar en Node: módulos nativos de Expo y el
 * motor de base de datos. Todo lo demás corre de verdad — si se simulara también la
 * lógica propia, la prueba solo demostraría que los mocks funcionan.
 */

// --- Módulos nativos de Expo ---------------------------------------------------

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => 'token-de-prueba'),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.4.5',
}));

/**
 * `expo-file-system@55` expone clases (`File`, `Directory`, `Paths`). El doble
 * reproduce solo la superficie que usa el código: existencia, tamaño y copia.
 */
jest.mock('expo-file-system', () => {
  class ArchivoFalso {
    constructor(...partes) {
      this.uri = partes.map(String).join('/');
      this.exists = true;
      this.size = 1024;
      this.name = String(partes[partes.length - 1] ?? 'archivo');
    }
    copy() {}
    delete() {}
  }

  class DirectorioFalso extends ArchivoFalso {
    create() {}
    list() { return []; }
  }

  return {
    File: ArchivoFalso,
    Directory: DirectorioFalso,
    Paths: { document: 'file:///documentos', cache: 'file:///cache' },
  };
});

// --- Entorno ---------------------------------------------------------------------

// `FormData` no existe en Node: la cola lo usa para armar la subida.
if (typeof global.FormData === 'undefined') {
  global.FormData = class FormDataFalso {
    constructor() { this.campos = []; }
    append(clave, valor, nombre) { this.campos.push({ clave, valor, nombre }); }
  };
}
