# OneSiteApp_Ex - Backend Microservices (NestJS)

Microservicio base construido con NestJS, implementando Clean Architecture y modularidad para gestionar el enrolamiento físico (Hardware) y la autenticación lógica (Auth) del proyecto OneSiteApp_Ex.

## 🚀 Requisitos Previos

- Node.js (v20+)
- SQL Server (Local o en red)
- Docker (Opcional, para infraestructura futura)

## 🛠️ Configuración Inicial

1. **Clonar el repositorio y entrar a la carpeta:**
   \`\`\`bash
   git clone <url-del-repo>
   cd onesiteapp_ex-ms
   \`\`\`

2. **Instalar dependencias:**
   \`\`\`bash
   npm install
   \`\`\`

3. **Configurar Variables de Entorno:**
   - Duplica el archivo `.env.example` (si existe) o crea un archivo `.env` en la raíz.
   - Configura las credenciales de SQL Server y los secretos JWT:
     \`\`\`env
     DB_USER=sa
     DB_PASSWORD=TuPassword
     DB_NAME=OneSiteAppDB
     JWT_SECRET=TuSecreto
     JWT_ACCESS_EXPIRATION=20m
     JWT_REFRESH_EXPIRATION=15d
     \`\`\`

4. **Ejecutar Script de Base de Datos:**
   - Abre tu gestor de SQL Server y ejecuta los scripts de las tablas maestras (`Empresas`, `Dispositivos`, `Usuarios`, `Roles_Permisos`).

## ⚙️ Ejecución del Proyecto

\`\`\`bash
# Modo desarrollo (Watch mode)
npm run start:dev

# Modo producción
npm run build
npm run start:prod
\`\`\`