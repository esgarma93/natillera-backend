import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { PartnersModule } from './partners/partners.module';
import { PaymentsModule } from './payments/payments.module';
import { PeriodsModule } from './periods/periods.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RafflesModule } from './raffles/raffles.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    RedisModule,
    StorageModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    PartnersModule,
    PaymentsModule,
    PeriodsModule,
    WhatsAppModule,
    VouchersModule,
    RafflesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
