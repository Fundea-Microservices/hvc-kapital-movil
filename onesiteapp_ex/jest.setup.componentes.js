/**
 * Simulaciones para las pruebas de componentes.
 *
 * Se simula SOLO lo que necesita un dispositivo real: cámara, selector de documentos,
 * sistema de archivos, GPS y la base de datos. Todo lo demás —el renderizado, la
 * lógica del componente, NativeWind— corre de verdad; si se simulara también eso, la
 * prueba no diría nada sobre lo que ve el asesor.
 */

// --- Módulos nativos de captura --------------------------------------------------

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  getPendingResultAsync: jest.fn(async () => null),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(async () => 'file:///cache/firma.png'),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getLastKnownPositionAsync: jest.fn(async () => null),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 14.6, longitude: -90.5 } })),
  Accuracy: { Lowest: 1 },
}));

// --- Capa de datos ---------------------------------------------------------------

/**
 * El servicio de multimedia toca la base y el sistema de archivos. Se simula entero:
 * su comportamiento ya está cubierto por el dominio y por las pruebas de integración,
 * y aquí lo que se verifica es qué se PINTA, no qué se guarda.
 */
jest.mock('./src/data/local/services/multimedia.service', () => ({
  ESTADO_SUBIDA: { PENDIENTE: 0, ERROR: 1, SUBIDO: 2, RECHAZADO: 3 },
  registrarArchivoLocal: jest.fn(async () => ({
    token: 'MEDIA::FOTO::evidencia.jpg::2048',
    uri: 'file:///documentos/multimedia/x/1-0-1.jpg',
    nombreVisible: 'evidencia.jpg',
    bytes: 2048,
  })),
  obtenerArchivoLocal: jest.fn(async () => null),
  eliminarArchivoLocal: jest.fn(async () => undefined),
  resolverUri: jest.fn((ruta) => `file:///documentos/${ruta}`),
}));

jest.mock('./src/data/local/services/parametros.service', () => ({
  obtenerParametro: jest.fn(async (_clave, porDefecto) => porDefecto),
  obtenerParametroNumerico: jest.fn(async (_clave, porDefecto) => porDefecto),
}));

jest.mock('./src/data/local/services/capturaPendiente', () => ({
  anotarCapturaPendiente: jest.fn(async () => undefined),
  limpiarCapturaPendiente: jest.fn(async () => undefined),
  consumirCapturaPendiente: jest.fn(async () => null),
}));

// Silencia el aviso de `Animated` que emite React Native en el entorno de pruebas y
// que no aporta nada al diagnóstico de un fallo real.
jest.spyOn(console, 'warn').mockImplementation(() => {});
