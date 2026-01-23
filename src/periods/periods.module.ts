import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PeriodsController } from './presentation/periods.controller';
import { PeriodsService } from './application/periods.service';
import { PeriodSchema, PeriodSchemaFactory } from './infrastructure/schemas/period.schema';
import { MongoPeriodRepository } from './infrastructure/repositories/mongo-period.repository';
import { PERIOD_REPOSITORY } from './domain/period.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PeriodSchema.name, schema: PeriodSchemaFactory },
    ]),
  ],
  controllers: [PeriodsController],
  providers: [
    PeriodsService,
    {
      provide: PERIOD_REPOSITORY,
      useClass: MongoPeriodRepository,
    },
  ],
  exports: [PeriodsService, PERIOD_REPOSITORY],
})
export class PeriodsModule {}
