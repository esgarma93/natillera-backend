import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { RafflesService } from './application/raffles.service';
import { RafflesController } from './presentation/raffles.controller';
import { MonthlyRaffleDocument, MonthlyRaffleSchema } from './infrastructure/schemas/monthly-raffle.schema';
import { MongoMonthlyRaffleRepository } from './infrastructure/repositories/mongo-monthly-raffle.repository';
import { PartnersModule } from '../partners/partners.module';
import { PaymentsModule } from '../payments/payments.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MonthlyRaffleDocument.name, schema: MonthlyRaffleSchema },
    ]),
    ScheduleModule.forRoot(),
    PartnersModule,
    PaymentsModule,
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [RafflesController],
  providers: [
    RafflesService,
    {
      provide: 'MonthlyRaffleRepository',
      useClass: MongoMonthlyRaffleRepository,
    },
  ],
  exports: [RafflesService],
})
export class RafflesModule {}
