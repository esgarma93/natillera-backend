import { Match } from './match.entity';

export const MATCH_REPOSITORY = 'MatchRepository';

export interface IMatchRepository {
  findAll(): Promise<Match[]>;
  findById(id: string): Promise<Match | null>;
  findByMatchNumber(matchNumber: number): Promise<Match | null>;
  findByPhase(phase: string): Promise<Match[]>;
  /** Matches whose kickoff falls within the [from, to) range. */
  findByDateRange(from: Date, to: Date): Promise<Match[]>;
  create(match: Match): Promise<Match>;
  update(id: string, data: Partial<Match>): Promise<Match | null>;
  count(): Promise<number>;
}
