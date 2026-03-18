import { Module } from '@nestjs/common';
import { VouchersController } from './presentation/vouchers.controller';
import { VouchersService } from './application/vouchers.service';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { PaymentsModule } from '../payments/payments.module';
import { PartnersModule } from '../partners/partners.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [WhatsAppModule, PaymentsModule, PartnersModule, IntegrationsModule],
  controllers: [VouchersController],
  providers: [VouchersService],
  exports: [VouchersService],
})
export class VouchersModule {}
