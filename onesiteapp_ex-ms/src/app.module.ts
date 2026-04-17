import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './users/user.entity';
import { DeviceController } from './modules/device-management/infrastructure/device.controller';
import { DeviceService } from './modules/device-management/application/device.service';
// import { DeviceModule } from './modules/device-management/device.module';
import { AuthModule } from './modules/auth/auth.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Hace que las variables del .env estén disponibles en toda la app
      envFilePath: '.env', // Especifica explícitamente el archivo a leer
    }),
    TypeOrmModule.forRoot({
      type: 'mssql',
      host: 'localhost',       // ej: localhost o IP servidor
      port: 5000,
      username: 'sa', // Tu usuario de SQL Server (NO uses Autenticación de Windows)
      password: 'OneSitePass@2026', // La contraseña de tu usuario
      database: 'onesiteapp_ex', // El nombre exacto de la base de datos que creaste
      entities: [__dirname + '/**/*.entity{.ts,.js}', User],

      //entities: [User],
      autoLoadEntities: true,

      synchronize: false, // ⚠️ nunca en producción

      options: {
        encrypt: false, // true si usas Azure
        trustServerCertificate: true,
      },
      
    }),
    AuthModule,
    SyncModule,
    //DeviceModule,
  ],
  controllers: [AppController,DeviceController],
  providers: [AppService, DeviceService],
  
})
export class AppModule {}
 