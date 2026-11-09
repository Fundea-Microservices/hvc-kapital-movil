import { Module } from '@nestjs/common';
import { SyncService } from './application/sync.service';
import { SyncController } from './infrastructure/sync.controller';

@Module({
  providers: [SyncService],
  controllers: [SyncController],
})
export class SyncModule {}
