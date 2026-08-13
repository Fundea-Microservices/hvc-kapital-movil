/**
 * Doble mínimo de `react-native` para las pruebas de integración.
 *
 * El paquete real se distribuye en ES Modules con sintaxis de Flow, que Jest no puede
 * parsear sin el preset nativo. La capa de datos solo lo toca de refilón —`Alert` en
 * el interceptor de errores y `Platform` para la bitácora—, así que cargar todo el
 * entorno de React Native para eso sería pagar mucho por nada.
 *
 * Si una prueba futura necesitara componentes de verdad, no es este el lugar: eso
 * pertenece al proyecto de pruebas de componentes, con el preset `jest-expo`.
 */
module.exports = {
  Alert: { alert: jest.fn() },
  Platform: { OS: 'android', select: (opciones) => opciones.android ?? opciones.default },
  NativeModules: {},
};
