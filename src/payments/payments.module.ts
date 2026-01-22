import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './presentation/payments.controller';
import { PaymentsService } from './application/payments.service';
import { MongoPaymentRepository } from './infrastructure/repositories/mongo-payment.repository';
import { PaymentSchema, PaymentSchemaFactory } from './infrastructure/schemas/payment.schema';
import { PartnersModule } from '../partners/partners.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentSchema.name, schema: PaymentSchemaFactory },
    ]),
    PartnersModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: 'PaymentRepository',
      useClass: MongoPaymentRepository,
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
