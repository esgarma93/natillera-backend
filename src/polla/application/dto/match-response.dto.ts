import { MatchPhase, MatchStatus, IPrediction } from '../../domain/match.entity';

export class MatchResponseDto {
  id: string;
  matchNumber: number;
  phase: MatchPhase;
  group?: string;
  homeTeam: string;
  awayTeam: string;
  stadium: string;
  city: string;
  date: Date;
  status: MatchStatus;
  homeScore?: number;
  awayScore?: number;
  predictions: IPrediction[];
  /** Computed: whether predictions can still be submitted right now. */
  allowsPrediction: boolean;
  /** Computed: whether both teams are real nations (not knockout placeholders). */
  teamsDefined: boolean;
  /** Computed: moment after which predictions lock (1h before kickoff). */
  lockTime: Date;
}

export class RankingEntryDto {
  /** Position in the ranking (1-based). */
  position: number;
  partnerId: string;
  partnerName: string;
  /** True when this ranking entry belongs to an invited guest. */
  isGuest?: boolean;
  /** Total points across all scored matches. */
  points: number;
  /** Number of predictions submitted. */
  predictions: number;
  /** Number of exact-score hits (max points). */
  exactHits: number;
  /** Number of correct-outcome hits (winner/draw guessed right). */
  outcomeHits: number;
  /** Prize this partner would win with the current standings (COP). */
  prize: number;
}

export class PollaPrizeSummaryDto {
  participants: number;
  entryFee: number;
  totalPot: number;
  natilleraCut: number;
  prizePool: number;
  firstPlacePrize: number;
  secondPlacePrize: number;
}

export class RankingResponseDto {
  ranking: RankingEntryDto[];
  prizes: PollaPrizeSummaryDto;
}

/** A partner who is missing predictions for upcoming matches (48h reminder job). */
export interface PredictionReminder {
  partnerId: string;
  partnerName: string;
  celular: string;
  matches: { homeTeam: string; awayTeam: string; date: Date }[];
}

