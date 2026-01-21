import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PartnerDocument, PartnerSchema } from './infrastructure/schemas/partner.schema';
import { MongoPartnerRepository } from './infrastructure/repositories/mongo-partner.repository';
import { PARTNER_REPOSITORY } from './domain/partner.repository';
import { PartnersService } from './application/partners.service';
import { PartnersController } from './presentation/partners.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PartnerDocument.name, schema: PartnerSchema },
    ]),
  ],
  controllers: [PartnersController],
  providers: [
    PartnersService,
    {
      provide: PARTNER_REPOSITORY,
      useClass: MongoPartnerRepository,
    },
  ],
  exports: [PartnersService],
})
export class PartnersModule {}
