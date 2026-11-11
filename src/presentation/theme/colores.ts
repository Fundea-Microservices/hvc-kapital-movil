/**
 * Paleta HVC Kapital para props que NO aceptan clases de Tailwind:
 * color de íconos, ActivityIndicator, borderColor dinámico.
 * Debe ir en paralelo con `tailwind.config.js`, que manda en el estilado por clase.
 */
export const COLORES = {
  navy: '#071737',   // CTAs primarios y barras
  blue: '#1E335E',   // Títulos
  orange: '#FA9A37', // Foco de inputs y CTA secundario
  gold: '#FCC232',
  sand: '#F9D3AD',
  gray: '#95A2BB',   // Bordes en reposo
  mist: '#A4ABBD',
  steel: '#8D9EBF',  // Texto secundario
  error: '#EF4444',
} as const;
