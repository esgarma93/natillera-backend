import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { PaymentStatus } from '../../domain/payment.entity';

export type PaymentDocument = PaymentSchema & Document;

@Schema({ timestamps: true, collection: 'payments' })
export class PaymentSchema {
  @Prop({ required: true })
  partnerId: string;

  @Prop()
  partnerName: string;

  @Prop({ required: true })
  periodId: string;

  @Prop()
  periodYear: number;

  @Prop({ required: true, min: 1, max: 12 })
  month: number;

  @Prop({ required: true })
  paymentDate: Date;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  expectedAmount: number;

  @Prop({ required: true })
  difference: number;

  @Prop({ type: String, required: true, enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Prop()
  pendingDescription: string;

  @Prop()
  voucherType: string;

  @Prop()
  voucherImageUrl: string;

  @Prop()
  voucherStorageKey: string;

  @Prop()
  whatsappMessageId: string;

  @Prop()
  notes: string;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const PaymentSchemaFactory = SchemaFactory.createForClass(PaymentSchema);

// Create compound index for unique payment per partner per month per period
PaymentSchemaFactory.index({ partnerId: 1, periodId: 1, month: 1 }, { unique: true });
