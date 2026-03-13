import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { IntegrationStatus } from '../../domain/integration.entity';

export type IntegrationDocument = IntegrationSchema & Document;

@Schema({ timestamps: true, collection: 'integrations' })
export class IntegrationSchema {
  @Prop({ required: true })
  periodId: string;

  @Prop({ required: true })
  periodYear: number;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ required: true })
  hostPartnerId: string;

  @Prop({ required: true })
  hostPartnerName: string;

  @Prop({ required: true, default: 0 })
  foodCostPerPerson: number;

  @Prop({ required: true, default: 6000 })
  profitabilityPerPerson: number;

  @Prop({ required: true, default: 6000 })
  activityCostPerPerson: number;

  @Prop({ required: true, default: 0 })
  totalCostPerPerson: number;

  @Prop({ required: true, default: 0 })
  absentPenalty: number;

  @Prop()
  activityWinnerId: string;

  @Prop()
  activityWinnerName: string;

  @Prop({ required: true, default: 0 })
  activityPot: number;

  @Prop({ required: true, default: 0 })
  activityPrize: number;

  @Prop({ type: [{ 
    partnerId: String, 
    partnerName: String, 
    isGuest: Boolean, 
    guestName: String, 
    invitedByPartnerId: String, 
    invitedByPartnerName: String, 
    paid: Boolean, 
    paymentId: String,
  }], default: [] })
  attendees: Array<{
    partnerId: string;
    partnerName: string;
    isGuest: boolean;
    guestName?: string;
    invitedByPartnerId?: string;
    invitedByPartnerName?: string;
    paid: boolean;
    paymentId?: string;
  }>;

  @Prop({ type: [String], default: [] })
  absentPartnerIds: string[];

  @Prop({ type: String, required: true, enum: IntegrationStatus, default: IntegrationStatus.UPCOMING })
  status: IntegrationStatus;

  @Prop()
  notes: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const IntegrationSchemaFactory = SchemaFactory.createForClass(IntegrationSchema);

IntegrationSchemaFactory.index({ periodId: 1, date: 1 });
IntegrationSchemaFactory.index({ periodYear: 1 });
IntegrationSchemaFactory.index({ status: 1 });
