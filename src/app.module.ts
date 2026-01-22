import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { PartnersModule } from './partners/partners.module';
import { PaymentsModule } from './payments/payments.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [DatabaseModule, PartnersModule, PaymentsModule, WhatsAppModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
