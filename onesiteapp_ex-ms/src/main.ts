import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
//import * as bcrypt from 'bcrypt'; // Añade esto

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Sin esta configuración rige el valor por defecto de Express: 100 kB. Una encuesta
  // larga con matrices lo supera con facilidad, y el rechazo llega como un 413 genérico
  // que la app reporta como "no se pudo sincronizar" — un fallo que aparece solo con
  // ciertos formularios y es difícil de atribuir. Los binarios de multimedia NO viajan
  // por aquí: van por `multipart/form-data`, con su propio límite en el interceptor.
  const limiteJson = process.env.BODY_JSON_LIMITE || '5mb';
  app.use(json({ limit: limiteJson }));
  app.use(urlencoded({ limit: limiteJson, extended: true }));

app.enableCors({
    origin: ['http://localhost:8081', 'http://localhost:4200', 'http://172.25.5.11', 'http://localhost','https://serviciosfundea.org'],
    credentials: true, // si usas cookies o Authorization headers
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  app.useGlobalPipes(new ValidationPipe());

  // --- TEST TEMPORAL ---
  //const testHash = await bcrypt.hash('123456', 10);
  //console.log('✅ HASH REAL PARA 123456:', testHash);
  // ---------------------

  await app.listen(process.env.PORT ?? 5030);
  
  console.log(`🚀 Microservicio corriendo en: http://localhost:5030`)
}
bootstrap();
