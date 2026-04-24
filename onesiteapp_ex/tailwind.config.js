// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          blue: '#1E3A8A', // Azul oscuro (OneSite)
          orange: '#F59E0B', // Naranja (OneSite)
          light: '#F3F4F6' // Fondo gris claro
        }
      }
    },
  },
  plugins: [],
}