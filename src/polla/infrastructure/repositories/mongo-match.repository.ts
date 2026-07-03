import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Match } from '../../domain/match.entity';
import { IMatchRepository } from '../../domain/match.repository';
import { MatchDocument, MatchSchema } from '../schemas/match.schema';

@Injectable()
export class MongoMatchRepository implements IMatchRepository {
  constructor(
    @InjectModel(MatchSchema.name)
    private readonly matchModel: Model<MatchDocument>,
  ) {}

  async findAll(): Promise<Match[]> {
    const docs = await this.matchModel.find().sort({ date: 1, matchNumber: 1 }).exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async findById(id: string): Promise<Match | null> {
    const doc = await this.matchModel.findById(id).exec();
    return doc ? this.toEntity(doc) : null;
  }

  async findByMatchNumber(matchNumber: number): Promise<Match | null> {
    const doc = await this.matchModel.findOne({ matchNumber }).exec();
    return doc ? this.toEntity(doc) : null;
  }

  async findByPhase(phase: string): Promise<Match[]> {
    const docs = await this.matchModel.find({ phase }).sort({ date: 1, matchNumber: 1 }).exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async findByDateRange(from: Date, to: Date): Promise<Match[]> {
    const docs = await this.matchModel
      .find({ date: { $gte: from, $lt: to } })
      .sort({ date: 1, matchNumber: 1 })
      .exec();
    return docs.map(doc => this.toEntity(doc));
  }

  async create(match: Match): Promise<Match> {
    const created = new this.matchModel({
      matchNumber: match.matchNumber,
      phase: match.phase,
      group: match.group,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      stadium: match.stadium,
      city: match.city,
      date: match.date,
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      penaltyWinner: match.penaltyWinner,
      predictions: match.predictions,
    });
    const saved = await created.save();
    return this.toEntity(saved);
  }

  async update(id: string, data: Partial<Match>): Promise<Match | null> {
    const updated = await this.matchModel
      .findByIdAndUpdate(id, { $set: data }, { new: true })
      .exec();
    return updated ? this.toEntity(updated) : null;
  }

  async count(): Promise<number> {
    return this.matchModel.countDocuments().exec();
  }

  private toEntity(doc: MatchDocument): Match {
    return new Match({
      id: doc._id.toString(),
      matchNumber: doc.matchNumber,
      phase: doc.phase,
      group: doc.group,
      homeTeam: doc.homeTeam,
      awayTeam: doc.awayTeam,
      stadium: doc.stadium,
      city: doc.city,
      date: doc.date,
      status: doc.status,
      homeScore: doc.homeScore,
      awayScore: doc.awayScore,
      penaltyWinner: doc.penaltyWinner || undefined,
      predictions: (doc.predictions || []) as any,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }
}
