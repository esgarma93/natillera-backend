import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IntegrationsController } from './presentation/integrations.controller';
import { IntegrationsService } from './application/integrations.service';
import { IntegrationSchema, IntegrationSchemaFactory } from './infrastructure/schemas/integration.schema';
import { MongoIntegrationRepository } from './infrastructure/repositories/mongo-integration.repository';
import { INTEGRATION_REPOSITORY } from './domain/integration.repository';
import { PartnersModule } from '../partners/partners.module';
import { PeriodsModule } from '../periods/periods.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IntegrationSchema.name, schema: IntegrationSchemaFactory },
    ]),
    PartnersModule,
    PeriodsModule,
  ],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    {
      provide: INTEGRATION_REPOSITORY,
      useClass: MongoIntegrationRepository,
    },
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
