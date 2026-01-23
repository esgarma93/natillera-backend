import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Period, PeriodStatus } from '../../domain/period.entity';
import { IPeriodRepository } from '../../domain/period.repository';
import { PeriodDocument, PeriodSchema } from '../schemas/period.schema';

@Injectable()
export class MongoPeriodRepository implements IPeriodRepository {
  constructor(
    @InjectModel(PeriodSchema.name)
    private readonly periodModel: Model<PeriodDocument>,
  ) {}

  async findAll(): Promise<Period[]> {
    const periods = await this.periodModel.find().sort({ year: -1 }).exec();
    return periods.map((doc) => this.toEntity(doc));
  }

  async findById(id: string): Promise<Period | null> {
    const period = await this.periodModel.findById(id).exec();
    return period ? this.toEntity(period) : null;
  }

  async findByYear(year: number): Promise<Period | null> {
    const period = await this.periodModel.findOne({ year }).exec();
    return period ? this.toEntity(period) : null;
  }

  async findActive(): Promise<Period | null> {
    const period = await this.periodModel.findOne({ status: PeriodStatus.ACTIVE }).exec();
    return period ? this.toEntity(period) : null;
  }

  async create(period: Period): Promise<Period> {
    const created = new this.periodModel({
      year: period.year,
      name: period.name,
      description: period.description,
      startDate: period.startDate,
      endDate: period.endDate,
      monthlyFee: period.monthlyFee,
      status: period.status,
      totalMonths: period.totalMonths,
    });
    const saved = await created.save();
    return this.toEntity(saved);
  }

  async update(id: string, data: Partial<Period>): Promise<Period | null> {
    const updated = await this.periodModel
      .findByIdAndUpdate(id, { $set: data }, { new: true })
      .exec();
    return updated ? this.toEntity(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.periodModel.findByIdAndDelete(id).exec();
    return !!result;
  }

  private toEntity(doc: PeriodDocument): Period {
    return new Period({
      id: doc._id.toString(),
      year: doc.year,
      name: doc.name,
      description: doc.description,
      startDate: doc.startDate,
      endDate: doc.endDate,
      monthlyFee: doc.monthlyFee,
      status: doc.status,
      totalMonths: doc.totalMonths,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }
}
