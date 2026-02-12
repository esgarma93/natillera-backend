import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { RaffleStatus } from '../../domain/monthly-raffle.entity';

@Schema({ collection: 'monthly_raffles', timestamps: true })
export class MonthlyRaffleDocument extends Document {
  @Prop({ required: true, min: 1, max: 12 })
  month: number;

  @Prop({ required: true })
  year: number;

  @Prop({ required: true })
  raffleDate: Date;

  @Prop({ required: true })
  drawDate: Date;

  @Prop()
  lotteryNumber?: string;

  @Prop()
  winningDigits?: string;

  @Prop({ required: true, default: 0 })
  totalCollected: number;

  @Prop({ required: true, default: 0 })
  prizeAmount: number;

  @Prop({ required: true, default: 0 })
  remainingAmount: number;

  @Prop()
  winnerId?: string;

  @Prop()
  winnerName?: string;

  @Prop()
  winnerRaffleNumber?: string;

  @Prop({ required: true, enum: Object.values(RaffleStatus), default: RaffleStatus.PENDING })
  status: RaffleStatus;
}

export const MonthlyRaffleSchema = SchemaFactory.createForClass(MonthlyRaffleDocument);

// Create compound index for month + year (unique)
MonthlyRaffleSchema.index({ month: 1, year: 1 }, { unique: true });
