import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Integration, IntegrationStatus } from '../../domain/integration.entity';
import { IIntegrationRepository } from '../../domain/integration.repository';
import { IntegrationDocument, IntegrationSchema } from '../schemas/integration.schema';

@Injectable()
export class MongoIntegrationRepository implements IIntegrationRepository {
  constructor(
    @InjectModel(IntegrationSchema.name)
    private readonly integrationModel: Model<IntegrationDocument>,
  ) {}

  async findAll(): Promise<Integration[]> {
    const docs = await this.integrationModel.find().sort({ date: -1 }).exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async findById(id: string): Promise<Integration | null> {
    const doc = await this.integrationModel.findById(id).exec();
    return doc ? this.toEntity(doc) : null;
  }

  async findByPeriodId(periodId: string): Promise<Integration[]> {
    const docs = await this.integrationModel.find({ periodId }).sort({ date: 1 }).exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async findByYear(year: number): Promise<Integration[]> {
    const docs = await this.integrationModel.find({ periodYear: year }).sort({ date: 1 }).exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async findByStatus(status: string): Promise<Integration[]> {
    const docs = await this.integrationModel.find({ status }).sort({ date: 1 }).exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async create(integration: Integration): Promise<Integration> {
    const created = new this.integrationModel({
      periodId: integration.periodId,
      periodYear: integration.periodYear,
      name: integration.name,
      date: integration.date,
      hostPartnerId: integration.hostPartnerId,
      hostPartnerName: integration.hostPartnerName,
      foodCostPerPerson: integration.foodCostPerPerson,
      profitabilityPerPerson: integration.profitabilityPerPerson,
      activityCostPerPerson: integration.activityCostPerPerson,
      totalCostPerPerson: integration.totalCostPerPerson,
      absentPenalty: integration.absentPenalty,
      activityWinnerId: integration.activityWinnerId,
      activityWinnerName: integration.activityWinnerName,
      activityPot: integration.activityPot,
      activityPrize: integration.activityPrize,
      attendees: integration.attendees,
      absentPartnerIds: integration.absentPartnerIds,
      status: integration.status,
      notes: integration.notes,
    });
    const saved = await created.save();
    return this.toEntity(saved);
  }

  async update(id: string, data: Partial<Integration>): Promise<Integration | null> {
    const updated = await this.integrationModel
      .findByIdAndUpdate(id, { $set: data }, { new: true })
      .exec();
    return updated ? this.toEntity(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.integrationModel.findByIdAndDelete(id).exec();
    return !!result;
  }

  private toEntity(doc: IntegrationDocument): Integration {
    return new Integration({
      id: doc._id.toString(),
      periodId: doc.periodId,
      periodYear: doc.periodYear,
      name: doc.name,
      date: doc.date,
      hostPartnerId: doc.hostPartnerId,
      hostPartnerName: doc.hostPartnerName,
      foodCostPerPerson: doc.foodCostPerPerson,
      profitabilityPerPerson: doc.profitabilityPerPerson,
      activityCostPerPerson: doc.activityCostPerPerson,
      totalCostPerPerson: doc.totalCostPerPerson,
      absentPenalty: doc.absentPenalty,
      activityWinnerId: doc.activityWinnerId,
      activityWinnerName: doc.activityWinnerName,
      activityPot: doc.activityPot,
      activityPrize: doc.activityPrize,
      attendees: doc.attendees || [],
      absentPartnerIds: doc.absentPartnerIds || [],
      status: doc.status,
      notes: doc.notes,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }
}
