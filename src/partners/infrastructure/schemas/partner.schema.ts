import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'partner' })
export class PartnerDocument extends Document {
  @Prop({ required: true, trim: true })
  nombre: string;

  @Prop({ trim: true, sparse: true, index: true })
  celular: string;

  @Prop({ required: true, min: 0 })
  montoCuota: number;

  @Prop({ required: true, unique: true })
  numeroRifa: number;

  @Prop({ type: Types.ObjectId, ref: 'PartnerDocument', default: null })
  idPartnerPatrocinador: Types.ObjectId | null;

  @Prop({ default: true })
  activo: boolean;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const PartnerSchema = SchemaFactory.createForClass(PartnerDocument);
