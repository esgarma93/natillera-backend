import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IPartnerRepository } from '../../domain/partner.repository';
import { Partner } from '../../domain/partner.entity';
import { PartnerDocument } from '../schemas/partner.schema';

@Injectable()
export class MongoPartnerRepository implements IPartnerRepository {
  constructor(
    @InjectModel(PartnerDocument.name)
    private readonly partnerModel: Model<PartnerDocument>,
  ) {}

  private toDomain(doc: PartnerDocument): Partner {
    return new Partner({
      id: doc._id.toString(),
      nombre: doc.nombre,
      montoCuota: doc.montoCuota,
      numeroRifa: doc.numeroRifa,
      idPartnerPatrocinador: doc.idPartnerPatrocinador?.toString() || undefined,
      activo: doc.activo,
      fechaCreacion: doc.createdAt,
      fechaActualizacion: doc.updatedAt,
    });
  }

  async findAll(): Promise<Partner[]> {
    const docs = await this.partnerModel.find().sort({ nombre: 1 }).exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  async findById(id: string): Promise<Partner | null> {
    const doc = await this.partnerModel.findById(id).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findByNumeroRifa(numeroRifa: number): Promise<Partner | null> {
    const doc = await this.partnerModel.findOne({ numeroRifa }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async create(partner: Partner): Promise<Partner> {
    const created = new this.partnerModel({
      nombre: partner.nombre,
      montoCuota: partner.montoCuota,
      numeroRifa: partner.numeroRifa,
      idPartnerPatrocinador: partner.idPartnerPatrocinador || null,
      activo: partner.activo,
    });
    const saved = await created.save();
    return this.toDomain(saved);
  }

  async update(id: string, data: Partial<Partner>): Promise<Partner | null> {
    const updated = await this.partnerModel
      .findByIdAndUpdate(id, { $set: data }, { new: true })
      .exec();
    return updated ? this.toDomain(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.partnerModel.findByIdAndDelete(id).exec();
    return !!result;
  }
}
