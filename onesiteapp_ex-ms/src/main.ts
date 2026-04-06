import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
app.enableCors({
    origin: ['http://localhost:8081', 'http://localhost:4200', 'http://172.25.5.11', 'http://localhost','https://serviciosfundea.org'],
    credentials: true, // si usas cookies o Authorization headers
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  });

  app.useGlobalPipes(new ValidationPipe());

  await app.listen(process.env.PORT ?? 5030);
  
  console.log(`🚀 Microservicio corriendo en: http://localhost:5030`)
}
bootstrap();
