// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],

  // ESTA ES LA LÍNEA CRUCIAL PARA NATIVEWIND v4
  presets: [require("nativewind/preset")],

  theme: {
    extend: {
      // Paleta institucional HVC Kapital. ÚNICA fuente de los hexadecimales de marca:
      // un color escrito a mano en una pantalla no se encuentra cuando cambie la guía.
      colors: {
        brand: {
          navy: '#071737',   // Azul oscuro principal: CTAs primarios y barras
          blue: '#1E335E',   // Azul institucional: títulos y encabezados
          orange: '#FA9A37', // Naranja institucional: foco de inputs y CTA secundario
          gold: '#FCC232',   // Naranja claro de apoyo
          sand: '#F9D3AD',   // Arena: fondos suaves y estados deshabilitados
          gray: '#95A2BB',   // Gris de bordes e inputs en reposo
          mist: '#A4ABBD',   // Gris de apoyo
          steel: '#8D9EBF',  // Gris de apoyo (texto secundario)
          light: '#F3F4F6',  // Fondo general de pantalla (gris ultra claro)
        },
      },

      // Inter oficial. En RN el peso NO viaja con la familia: `font-bold` sobre
      // Inter_400Regular lo sintetiza o cae al sistema, así que cada peso es familia.
      fontFamily: {
        sans: ['Inter_400Regular'],
        'inter-medium': ['Inter_500Medium'],
        'inter-semibold': ['Inter_600SemiBold'],
        'inter-bold': ['Inter_700Bold'],
      },

      borderRadius: {
        // Radios de la guía: 8-10px en inputs, 10-12px en botones.
        input: '10px',
        cta: '12px',
      },
    },
  },
  plugins: [],
}
