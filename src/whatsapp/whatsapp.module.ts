import { Module } from '@nestjs/common';
import { WhatsAppController } from './presentation/whatsapp.controller';
import { WhatsAppService } from './application/whatsapp.service';
import { OcrService } from './application/ocr.service';
import { VoucherParserService } from './application/voucher-parser.service';
import { PaymentsModule } from '../payments/payments.module';
import { PartnersModule } from '../partners/partners.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PaymentsModule, PartnersModule, UsersModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, OcrService, VoucherParserService],
  exports: [WhatsAppService, OcrService, VoucherParserService],
})
export class WhatsAppModule {}
