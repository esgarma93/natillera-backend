import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PollaController } from './presentation/polla.controller';
import { PollaService } from './application/polla.service';
import { PollaCronHandler } from './application/polla-cron.handler';
import { MatchSchema, MatchSchemaFactory } from './infrastructure/schemas/match.schema';
import { MongoMatchRepository } from './infrastructure/repositories/mongo-match.repository';
import { MATCH_REPOSITORY } from './domain/match.repository';
import { PartnersModule } from '../partners/partners.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MatchSchema.name, schema: MatchSchemaFactory },
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
  ],
  exports: [PollaService],
})
export class PollaModule {}
