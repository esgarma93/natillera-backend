import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PollaController } from './presentation/polla.controller';
import { PollaService } from './application/polla.service';
import { PollaCronHandler } from './application/polla-cron.handler';
import { MatchSchema, MatchSchemaFactory } from './infrastructure/schemas/match.schema';
import { PollaGuestSchema, PollaGuestSchemaFactory } from './infrastructure/schemas/polla-guest.schema';
import { MongoMatchRepository } from './infrastructure/repositories/mongo-match.repository';
import { MongoPollaGuestRepository } from './infrastructure/repositories/mongo-polla-guest.repository';
import { MATCH_REPOSITORY } from './domain/match.repository';
import { POLLA_GUEST_REPOSITORY } from './domain/polla-guest.repository';
import { PartnersModule } from '../partners/partners.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MatchSchema.name, schema: MatchSchemaFactory },
      { name: PollaGuestSchema.name, schema: PollaGuestSchemaFactory },
    ]),
    PartnersModule,
  ],
  controllers: [PollaController],
  providers: [
    PollaService,
    PollaCronHandler,
    {
      provide: MATCH_REPOSITORY,
      useClass: MongoMatchRepository,
    },
    {
      provide: POLLA_GUEST_REPOSITORY,
      useClass: MongoPollaGuestRepository,
    },
  ],
  exports: [PollaService],
})
export class PollaModule {}
