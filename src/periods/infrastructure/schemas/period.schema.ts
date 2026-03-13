import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { PeriodStatus } from '../../domain/period.entity';

export type PeriodDocument = PeriodSchema & Document;

@Schema({ timestamps: true, collection: 'periods' })
export class PeriodSchema {
  @Prop({ required: true, unique: true })
  year: number;

  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true })
  monthlyFee: number;

  @Prop({ default: 6000 })
  profitabilityPerPerson: number;

  @Prop({ default: 6000 })
  activityCostPerPerson: number;

  @Prop({ default: 7000 })
  raffleFee: number;

  @Prop({ type: String, required: true, enum: PeriodStatus, default: PeriodStatus.UPCOMING })
  status: PeriodStatus;

  @Prop({ required: true, default: 12 })
  totalMonths: number;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const PeriodSchemaFactory = SchemaFactory.createForClass(PeriodSchema);
