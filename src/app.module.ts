import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { PartnersModule } from './partners/partners.module';

@Module({
  imports: [DatabaseModule, PartnersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
