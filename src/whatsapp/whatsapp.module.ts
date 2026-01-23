import { Module } from '@nestjs/common';
import { WhatsAppController } from './presentation/whatsapp.controller';
import { WhatsAppService } from './application/whatsapp.service';
import { OcrService } from './application/ocr.service';
import { VoucherParserService } from './application/voucher-parser.service';
import { PaymentsModule } from '../payments/payments.module';
import { PartnersModule } from '../partners/partners.module';

@Module({
  imports: [PaymentsModule, PartnersModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, OcrService, VoucherParserService],
  exports: [WhatsAppService, OcrService, VoucherParserService],
})
export class WhatsAppModule {}
