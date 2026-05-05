import { Module } from '@nestjs/common';
import { SurveysService } from './application/surveys.service';
import { SurveysController } from './infrastructure/surveys.controller';

@Module({
  providers: [SurveysService],
  controllers: [SurveysController]
})
export class SurveysModule {}
