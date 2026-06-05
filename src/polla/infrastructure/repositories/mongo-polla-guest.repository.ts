import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IPollaGuestRepository } from '../../domain/polla-guest.repository';
import { PollaGuest } from '../../domain/polla-guest.entity';
import { PollaGuestDocument, PollaGuestSchema } from '../schemas/polla-guest.schema';

@Injectable()
export class MongoPollaGuestRepository implements IPollaGuestRepository {
  constructor(
    @InjectModel(PollaGuestSchema.name)
    private readonly guestModel: Model<PollaGuestDocument>,
  ) {}

  private toEntity(doc: PollaGuestDocument): PollaGuest {
    return new PollaGuest({
      id: doc._id.toString(),
      nombre: doc.nombre,
      invitedByPartnerId: doc.invitedByPartnerId,
      invitedByName: doc.invitedByName,
      activo: doc.activo,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }

  async findAll(): Promise<PollaGuest[]> {
    const docs = await this.guestModel.find().sort({ nombre: 1 }).exec();
    return docs.map(d => this.toEntity(d));
  }

  async findById(id: string): Promise<PollaGuest | null> {
    const doc = await this.guestModel.findById(id).exec();
    return doc ? this.toEntity(doc) : null;
  }

  async create(guest: PollaGuest): Promise<PollaGuest> {
    const created = new this.guestModel({
      nombre: guest.nombre,
      invitedByPartnerId: guest.invitedByPartnerId,
      invitedByName: guest.invitedByName,
      activo: guest.activo,
    });
    const saved = await created.save();
    return this.toEntity(saved);
  }

  async update(id: string, data: Partial<PollaGuest>): Promise<PollaGuest | null> {
    const updated = await this.guestModel
      .findByIdAndUpdate(id, { $set: data }, { new: true })
      .exec();
    return updated ? this.toEntity(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.guestModel.findByIdAndDelete(id).exec();
    return !!result;
  }
}
