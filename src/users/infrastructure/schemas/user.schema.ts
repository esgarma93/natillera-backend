import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'users' })
export class UserDocument extends Document {
  @Prop({ required: true, unique: true, trim: true, index: true })
  celular: string;

  @Prop({ required: true })
  password: string; // Hashed password

  @Prop({ required: true, enum: ['admin', 'viewer'], default: 'viewer' })
  role: string;

  @Prop({ type: Types.ObjectId, ref: 'PartnerDocument', required: true, unique: true, index: true })
  partnerId: Types.ObjectId;

  @Prop({ default: true })
  activo: boolean;

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(UserDocument);

// Add indexes
UserSchema.index({ celular: 1 });
UserSchema.index({ partnerId: 1 });
