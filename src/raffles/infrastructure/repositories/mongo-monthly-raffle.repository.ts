import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MonthlyRaffle } from '../../domain/monthly-raffle.entity';
import { MonthlyRaffleRepository } from '../../domain/monthly-raffle.repository';
import { MonthlyRaffleDocument } from '../schemas/monthly-raffle.schema';

@Injectable()
export class MongoMonthlyRaffleRepository implements MonthlyRaffleRepository {
  constructor(
    @InjectModel(MonthlyRaffleDocument.name)
    private readonly raffleModel: Model<MonthlyRaffleDocument>,
  ) {}

  async create(raffle: MonthlyRaffle): Promise<MonthlyRaffle> {
    const created = await this.raffleModel.create(raffle);
    return this.toEntity(created);
  }

  async findById(id: string): Promise<MonthlyRaffle | null> {
    const doc = await this.raffleModel.findById(id).exec();
    return doc ? this.toEntity(doc) : null;
  }

  async findByMonthAndYear(month: number, year: number): Promise<MonthlyRaffle | null> {
    const doc = await this.raffleModel.findOne({ month, year }).exec();
    return doc ? this.toEntity(doc) : null;
  }

  async findAll(): Promise<MonthlyRaffle[]> {
    const docs = await this.raffleModel.find().sort({ year: -1, month: -1 }).exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async findByYear(year: number): Promise<MonthlyRaffle[]> {
    const docs = await this.raffleModel.find({ year }).sort({ month: -1 }).exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async update(id: string, updates: Partial<MonthlyRaffle>): Promise<MonthlyRaffle | null> {
    const doc = await this.raffleModel
      .findByIdAndUpdate(id, { ...updates, updatedAt: new Date() }, { new: true })
      .exec();
    return doc ? this.toEntity(doc) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.raffleModel.findByIdAndDelete(id).exec();
    return !!result;
  }

  private toEntity(doc: MonthlyRaffleDocument): MonthlyRaffle {
    return new MonthlyRaffle({
      id: doc._id.toString(),
      month: doc.month,
      year: doc.year,
      raffleDate: doc.raffleDate,
      drawDate: doc.drawDate,
      lotteryNumber: doc.lotteryNumber,
      winningDigits: doc.winningDigits,
      totalCollected: doc.totalCollected,
      prizeAmount: doc.prizeAmount,
      remainingAmount: doc.remainingAmount,
      winnerId: doc.winnerId,
      winnerName: doc.winnerName,
      winnerRaffleNumber: doc.winnerRaffleNumber,
      status: doc.status,
      createdAt: (doc as any).createdAt || new Date(),
      updatedAt: (doc as any).updatedAt || new Date(),
    });
  }
}
