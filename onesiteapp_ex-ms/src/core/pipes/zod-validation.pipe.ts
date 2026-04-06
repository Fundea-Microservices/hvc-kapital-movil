import { PipeTransform, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    try {
      // Intenta validar el body contra el esquema de Zod
      const parsedValue = this.schema.parse(value);
      return parsedValue;
    } catch (error) {
      // Si falla, lanza un error 400 detallado
      throw new BadRequestException({
        message: 'Error de validación de datos',
        errors: error.errors,
      });
    }
  }
}