import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

/**
 * Contrato de navegación de la aplicación.
 *
 * Declarar aquí los parámetros de cada pantalla permite que TypeScript verifique
 * las llamadas a `navigate(...)` y el acceso a `route.params`, evitando el uso de
 * `any` en los componentes y detectando en compilación los nombres de parámetro
 * mal escritos (una fuente habitual de pantallas en blanco).
 */
export type RootStackParamList = {
  Enrollment: undefined;
  Login: undefined;
  /**
   * Cambio de contraseña. Sin params (o `voluntario: false`) = obligatorio de primer
   * ingreso (gate). `voluntario: true` = abierto desde el menú Perfil, con botón atrás.
   */
  CambioPassword: { voluntario?: boolean } | undefined;
  Dashboard: undefined;
  SurveyClients: {
    idEncuesta: string;
  };
  DynamicSurvey: {
    idEncuesta: string;
    /** UUID de la instancia a continuar; ausente al crear una encuesta nueva. */
    uuidInstanciaBase?: string;
    idCliente?: string | null;
  };
};

/** Navegación tipada para cualquier pantalla del stack principal. */
export type NavegacionApp = NativeStackNavigationProp<RootStackParamList>;

/** Ruta tipada de una pantalla concreta: RutaDe<'DynamicSurvey'>. */
export type RutaDe<T extends keyof RootStackParamList> = RouteProp<RootStackParamList, T>;
