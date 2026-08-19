import { Module } from '@nestjs/common';
import { SurveysService } from './application/surveys.service';
import { CatalogosExternosService } from './application/catalogos-externos.service';
import { SurveysController } from './infrastructure/surveys.controller';

@Module({
  providers: [SurveysService, CatalogosExternosService],
  controllers: [SurveysController],
})
export class SurveysModule {}
