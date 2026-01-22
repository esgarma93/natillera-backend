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
  paymentDate: Date;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  expectedAmount: number;

  @Prop({ required: true })
  difference: number;

  @Prop({ required: true, enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Prop()
  voucherImageUrl: string;

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
