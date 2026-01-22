import { Module } from '@nestjs/common';
import { WhatsAppController } from './presentation/whatsapp.controller';
import { WhatsAppService } from './application/whatsapp.service';
import { OcrService } from './application/ocr.service';
import { PaymentsModule } from '../payments/payments.module';
import { PartnersModule } from '../partners/partners.module';

@Module({
  imports: [PaymentsModule, PartnersModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, OcrService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
