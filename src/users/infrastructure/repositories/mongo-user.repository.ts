import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IUserRepository } from '../../domain/user.repository';
import { User, UserRole } from '../../domain/user.entity';
import { UserDocument } from '../schemas/user.schema';

@Injectable()
export class MongoUserRepository implements IUserRepository {
  constructor(
    @InjectModel(UserDocument.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  private toDomain(doc: UserDocument): User {
    return new User({
      id: doc._id.toString(),
      celular: doc.celular,
      password: doc.password,
      role: doc.role as UserRole,
      partnerId: doc.partnerId.toString(),
      activo: doc.activo,
      fechaCreacion: doc.createdAt,
      fechaActualizacion: doc.updatedAt,
    });
  }

  async findAll(): Promise<User[]> {
    const docs = await this.userModel.find().sort({ createdAt: -1 }).exec();
    return docs.map((doc) => this.toDomain(doc));
  }

  async findById(id: string): Promise<User | null> {
    const doc = await this.userModel.findById(id).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findByCelular(celular: string): Promise<User | null> {
    const doc = await this.userModel.findOne({ celular }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findByPartnerId(partnerId: string): Promise<User | null> {
    const doc = await this.userModel.findOne({ partnerId }).exec();
    return doc ? this.toDomain(doc) : null;
  }

  async create(user: User): Promise<User> {
    const created = new this.userModel({
      celular: user.celular,
      password: user.password,
      role: user.role,
      partnerId: user.partnerId,
      activo: user.activo,
    });
    const saved = await created.save();
    return this.toDomain(saved);
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    const updated = await this.userModel
      .findByIdAndUpdate(id, { $set: data }, { new: true })
      .exec();
    return updated ? this.toDomain(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.userModel.findByIdAndDelete(id).exec();
    return !!result;
  }
}
