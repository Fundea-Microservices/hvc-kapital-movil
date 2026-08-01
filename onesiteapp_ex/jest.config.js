/**
 * Pruebas de la capa de dominio.
 *
 * Se usa `ts-jest` puro en vez del preset de Expo/React Native a propósito: el
 * dominio NO importa React ni WatermelonDB (esa es justamente la propiedad que lo
 * hace testeable), así que no hace falta el entorno nativo. La suite corre en
 * segundos, sin emulador y sin mocks de módulos nativos.
 *
 * `roots` acota a src/domain: si algún día una prueba necesitara renderizar un
 * componente, requeriría `jest-expo` y sería una configuración aparte.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/domain'],
  testMatch: ['**/*.spec.ts'],
  clearMocks: true,
};
