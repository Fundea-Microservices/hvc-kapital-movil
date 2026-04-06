# OneSiteApp_Ex - Mobile App (React Native / Expo)

Aplicación móvil Offline-First diseñada para trabajo de campo en Guatemala. Construida sobre React Native (New Architecture) utilizando Expo Dev Client, WatermelonDB (SQLite) para alta concurrencia y Zustand para la gestión de estado.

## 🚀 Requisitos Previos

- Node.js (v20+)
- Android Studio (SDK, Emulador y Variables de Entorno configuradas)
- Dispositivo físico o Emulador Android.

## 🛠️ Configuración Inicial

1. **Clonar e instalar dependencias:**
   \`\`\`bash
   git clone <url-del-repo>
   cd onesiteapp_ex
   npm install
   \`\`\`

2. **Configurar Variables de Entorno:**
   Crea un archivo `.env` en la raíz del proyecto y apunta la API a la dirección IP de la máquina donde corre el backend NestJS:
   \`\`\`env
   EXPO_PUBLIC_API_URL=http://TU_IP_LOCAL:3000/api/v1
   \`\`\`

3. **Generar el Código Nativo (Prebuild):**
   Dado que usamos WatermelonDB, requerimos generar las carpetas de Android/iOS nativas.
   \`\`\`bash
   npx expo prebuild --clean
   \`\`\`

## ⚙️ Compilación y Ejecución

1. **Compilar la aplicación nativa (Dev Client):**
   Asegúrate de tener un emulador abierto o un teléfono conectado por USB con depuración habilitada.
   \`\`\`bash
   npx expo run:android
   \`\`\`

2. **Iniciar el servidor Metro:**
   Una vez que la app está instalada en el dispositivo:
   \`\`\`bash
   npx expo start --dev-client
   \`\`\`