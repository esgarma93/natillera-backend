import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PollaGuestDocument = PollaGuestSchema & Document;

@Schema({ timestamps: true, collection: 'polla_guests' })
export class PollaGuestSchema {
  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true })
  invitedByPartnerId: string;

  @Prop()
  invitedByName: string;

  @Prop({ default: true })
  activo: boolean;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const PollaGuestSchemaFactory = SchemaFactory.createForClass(PollaGuestSchema);
