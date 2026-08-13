import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config'; // Importante añadir ConfigService
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
// import { User } from './users/user.entity'; // Ya no es necesario si se usas autoLoadEntities
import { DeviceController } from './modules/device-management/infrastructure/device.controller';
import { DeviceService } from './modules/device-management/application/device.service';
// import { DeviceModule } from './modules/device-management/device.module';
import { AuthModule } from './modules/auth/auth.module';
import { SyncModule } from './modules/sync/sync.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { MultimediaModule } from './modules/multimedia/multimedia.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Hace que las variables del .env estén disponibles en toda la app
      // Ruta ABSOLUTA calculada desde el propio archivo. Una ruta relativa se resuelve
      // contra el directorio de trabajo del proceso, que bajo un gestor como pm2 puede
      // no ser la raíz del proyecto: entonces el .env no se lee y —si las credenciales
      // de BD vienen del entorno del sistema— la app arranca bien y solo fallan las
      // variables nuevas, que es un síntoma desconcertante de diagnosticar.
      // __dirname es dist/ en ejecución y src/ en desarrollo; en ambos casos el .env
      // está un nivel por encima.
      envFilePath: join(__dirname, '..', '.env'),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
      type: 'mssql',
      host: process.env.DB_HOST,       // ej: localhost o IP servidor
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME, // Tu usuario de SQL Server (NO uses Autenticación de Windows)
      password: process.env.DB_PASSWORD, // La contraseña de tu usuario
      database: process.env.DB_NAME, // El nombre exacto de la base de datos que creaste
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
     
      autoLoadEntities: true,
      synchronize: false, // ⚠️ nunca en producción
      options: {
        encrypt: false, // true si usas Azure
        trustServerCertificate: true,
      },
      }),
    }),
    AuthModule,
    SyncModule,
    SurveysModule,
    MultimediaModule,
    DiagnosticsModule,
    //DeviceModule,
  ],
  controllers: [AppController,DeviceController],
  providers: [AppService, DeviceService],
  
})
export class AppModule {}
 