import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { MatchPhase, MatchStatus } from '../../domain/match.entity';

export type MatchDocument = MatchSchema & Document;

@Schema({ timestamps: true, collection: 'polla_matches' })
export class MatchSchema {
  @Prop({ required: true, unique: true })
  matchNumber: number;

  @Prop({ type: String, required: true, enum: MatchPhase })
  phase: MatchPhase;

  @Prop()
  group: string;

  @Prop({ required: true })
  homeTeam: string;

  @Prop({ required: true })
  awayTeam: string;

  @Prop({ required: true })
  stadium: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  date: Date;

  @Prop({ type: String, required: true, enum: MatchStatus, default: MatchStatus.OPEN })
  status: MatchStatus;

  @Prop()
  homeScore: number;

  @Prop()
  awayScore: number;

  @Prop()
  penaltyWinner: string;

  @Prop({
    type: [{
      partnerId: String,
      partnerName: String,
      isGuest: Boolean,
      invitedByPartnerId: String,
      homeScore: Number,
      awayScore: Number,
      points: Number,
      createdAt: Date,
      updatedAt: Date,
    }],
    default: [],
  })
  predictions: Array<{
    partnerId: string;
    partnerName: string;
    isGuest?: boolean;
    invitedByPartnerId?: string;
    homeScore: number;
    awayScore: number;
    points: number;
    createdAt: Date;
    updatedAt: Date;
  }>;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const MatchSchemaFactory = SchemaFactory.createForClass(MatchSchema);

MatchSchemaFactory.index({ phase: 1, date: 1 });
MatchSchemaFactory.index({ date: 1 });
