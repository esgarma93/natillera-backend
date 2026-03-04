import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppController } from './presentation/whatsapp.controller';
import { WhatsAppService } from './application/whatsapp.service';
import { WhatsAppMessagingService } from './application/whatsapp-messaging.service';
import { WhatsAppAuthHandler } from './application/whatsapp-auth.handler';
import { WhatsAppPaymentHandler } from './application/whatsapp-payment.handler';
import { WhatsAppQueryHandler } from './application/whatsapp-query.handler';
import { WhatsAppCronHandler } from './application/whatsapp-cron.handler';
import { OcrService } from './application/ocr.service';
import { VoucherParserService } from './application/voucher-parser.service';
import { PaymentsModule } from '../payments/payments.module';
import { PartnersModule } from '../partners/partners.module';
import { UsersModule } from '../users/users.module';
import { RafflesModule } from '../raffles/raffles.module';

@Module({
  imports: [PaymentsModule, PartnersModule, UsersModule, forwardRef(() => RafflesModule)],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppMessagingService,
    WhatsAppAuthHandler,
    WhatsAppPaymentHandler,
    WhatsAppQueryHandler,
    WhatsAppCronHandler,
    OcrService,
    VoucherParserService,
  ],
  exports: [WhatsAppService, WhatsAppMessagingService, OcrService, VoucherParserService],
})
export class WhatsAppModule {}
