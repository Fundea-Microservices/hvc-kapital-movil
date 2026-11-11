/**
 * Configuración de pruebas, dividida en proyectos.
 *
 * POR QUÉ PROYECTOS Y NO UNA SOLA CONFIGURACIÓN
 * Cada capa necesita un entorno distinto y mezclarlos obliga a cargar el más pesado
 * para todo. El dominio corre en segundos con `ts-jest` puro; las pruebas de
 * integración necesitan mocks de módulos nativos; las de componentes exigirían el
 * preset de Expo. Separarlos mantiene el ciclo corto donde más se ejecuta.
 *
 * `npm test` corre todos; para uno solo: `npx jest --selectProjects dominio`.
 */
module.exports = {
  projects: [
    {
      /**
       * DOMINIO — lógica de negocio pura.
       *
       * Se usa `ts-jest` en vez del preset de Expo/React Native a propósito: el
       * dominio NO importa React ni WatermelonDB (esa es justamente la propiedad que
       * lo hace testeable), así que no hace falta el entorno nativo. La suite corre en
       * segundos, sin emulador y sin mocks de módulos nativos.
       */
      displayName: 'dominio',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/domain'],
      testMatch: ['**/*.spec.ts'],
      clearMocks: true,
    },
    {
      /**
       * INTEGRACIÓN — capa de datos: sincronización y cola de multimedia.
       *
       * Aquí sí hay dependencias del entorno (WatermelonDB, SecureStore, axios), así
       * que se simulan en `src/data/__mocks__`. La regla que rige estas pruebas:
       * **preferir extraer y probar la decisión pura antes que simular todo el
       * stack**. Un mock que reproduce el comportamiento completo de WatermelonDB se
       * desalinea del real y acaba probando el mock, no el código.
       */
      displayName: 'integracion',
      preset: 'ts-jest',
      testEnvironment: 'node',
      roots: ['<rootDir>/src/data'],
      testMatch: ['**/*.spec.ts'],
      clearMocks: true,
      setupFiles: ['<rootDir>/jest.setup.integracion.js'],
      moduleNameMapper: {
        // `react-native` se distribuye con sintaxis de Flow que Jest no parsea sin el
        // preset nativo. La capa de datos solo usa `Alert` y `Platform`.
        '^react-native$': '<rootDir>/test/stubs/react-native.js',
        // WatermelonDB se usa REAL: su núcleo es JavaScript plano. Lo único nativo es
        // el adaptador SQLite, y es lo único que se sustituye.
        '^@nozbe/watermelondb/adapters/sqlite$': '<rootDir>/test/stubs/sqlite-adapter.js',
      },
    },
    {
      /**
       * COMPONENTES — lo que ve el asesor.
       *
       * Aquí sí hace falta el preset de Expo: se renderiza React Native de verdad.
       * Es el proyecto más lento y el más frágil de configurar, por eso va aparte:
       * si se rompe con una actualización del SDK, los otros dos siguen corriendo.
       *
       * `transformIgnorePatterns` es obligatorio: los paquetes de Expo y React Native
       * se publican como ES Modules sin transpilar, y sin esto Jest falla con
       * "Cannot use import statement outside a module".
       */
      displayName: 'componentes',
      preset: 'jest-expo',
      roots: ['<rootDir>/src/presentation'],
      testMatch: ['**/*.spec.tsx'],
      clearMocks: true,
      setupFilesAfterEnv: ['<rootDir>/jest.setup.componentes.js'],
      moduleNameMapper: {
        // Lucide resuelve a .mjs, extensión que el transform del preset no toca.
        // Se apunta a su build CJS: mismo icono, sin ESM sin transpilar.
        '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
      },
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|nativewind|react-native-css-interop|lucide-react-native)',
      ],
    },
  ],
};
