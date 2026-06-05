export enum MatchPhase {
  GRUPOS = 'grupos',
  DIECISEISAVOS = 'dieciseisavos',
  OCTAVOS = 'octavos',
  CUARTOS = 'cuartos',
  SEMIFINAL = 'semifinal',
  TERCER_PUESTO = 'tercer_puesto',
  FINAL = 'final',
}

export enum MatchStatus {
  /** Predictions are allowed (more than 24h before kickoff). */
  OPEN = 'open',
  /** Locked: less than 24h before kickoff. No more predictions. */
  CLOSED = 'closed',
  /** Match finished and final result registered. */
  FINISHED = 'finished',
}

export interface IPrediction {
  partnerId: string;
  partnerName: string;
  /** True when this prediction belongs to an invited guest (not a partner). */
  isGuest?: boolean;
  /** Partner who invited the guest (only when isGuest). */
  invitedByPartnerId?: string;
  homeScore: number;
  awayScore: number;
  /** Points earned once the match result is known (0 until scored). */
  points: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMatch {
  id?: string;
  /** Official FIFA match number (1-104). Used as stable external id. */
  matchNumber: number;
  phase: MatchPhase;
  /** Group letter A-L (only for group stage). */
  group?: string;
  homeTeam: string;
  awayTeam: string;
  stadium: string;
  city: string;
  /** Kickoff date and time (stored in UTC). */
  date: Date;
  status: MatchStatus;
  /** Final score (only when status = finished). */
  homeScore?: number;
  awayScore?: number;
  predictions: IPrediction[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Points per scoring rule. Knockout phases (eliminación directa) award double.
 * Rules are cumulative — an exact score earns all of them (max 10 / 20).
 */
export const POINTS = {
  /** Correct outcome (winner or draw). */
  OUTCOME: { group: 5, knockout: 10 },
  /** Correct number of goals for the home team. */
  HOME_GOALS: { group: 2, knockout: 4 },
  /** Correct number of goals for the away team. */
  AWAY_GOALS: { group: 2, knockout: 4 },
  /** Correct goal difference. */
  GOAL_DIFFERENCE: { group: 1, knockout: 2 },
};

/** Hours before kickoff after which predictions are locked. */
export const PREDICTION_LOCK_HOURS = 24;

/** Phases that count as knockout (eliminación directa) for double points. */
const KNOCKOUT_PHASES = new Set<MatchPhase>([
  MatchPhase.DIECISEISAVOS,
  MatchPhase.OCTAVOS,
  MatchPhase.CUARTOS,
  MatchPhase.SEMIFINAL,
  MatchPhase.TERCER_PUESTO,
  MatchPhase.FINAL,
]);

export class Match implements IMatch {
  id?: string;
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
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<IMatch>) {
    this.id = partial.id;
    this.matchNumber = partial.matchNumber || 0;
    this.phase = partial.phase || MatchPhase.GRUPOS;
    this.group = partial.group;
    this.homeTeam = partial.homeTeam || '';
    this.awayTeam = partial.awayTeam || '';
    this.stadium = partial.stadium || '';
    this.city = partial.city || '';
    this.date = partial.date || new Date();
    this.status = partial.status || MatchStatus.OPEN;
    this.homeScore = partial.homeScore;
    this.awayScore = partial.awayScore;
    this.predictions = partial.predictions || [];
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }

  /** Whether this match belongs to a knockout phase (double points). */
  isKnockout(): boolean {
    return KNOCKOUT_PHASES.has(this.phase);
  }

  /** Moment after which predictions are no longer allowed. */
  getLockTime(): Date {
    return new Date(this.date.getTime() - PREDICTION_LOCK_HOURS * 60 * 60 * 1000);
  }

  /** Whether a prediction can be submitted right now. */
  allowsPrediction(now: Date = new Date()): boolean {
    return this.status === MatchStatus.OPEN && now < this.getLockTime();
  }

  /**
   * Compute the points a prediction earns against the final result.
   * Rules are cumulative (outcome + home goals + away goals + goal difference).
   * Knockout phases award double points.
   */
  static scorePrediction(
    homeScore: number,
    awayScore: number,
    predHome: number,
    predAway: number,
    knockout: boolean,
  ): number {
    const tier = knockout ? 'knockout' : 'group';
    let points = 0;

    // Correct outcome (winner / draw)
    if (Math.sign(homeScore - awayScore) === Math.sign(predHome - predAway)) {
      points += POINTS.OUTCOME[tier];
    }
    // Correct home goals
    if (predHome === homeScore) {
      points += POINTS.HOME_GOALS[tier];
    }
    // Correct away goals
    if (predAway === awayScore) {
      points += POINTS.AWAY_GOALS[tier];
    }
    // Correct goal difference
    if (predHome - predAway === homeScore - awayScore) {
      points += POINTS.GOAL_DIFFERENCE[tier];
    }

    return points;
  }

  /** Recalculate the points of every prediction using the final result. */
  recalculatePredictionPoints(): void {
    if (this.homeScore === undefined || this.awayScore === undefined) {
      return;
    }
    const knockout = this.isKnockout();
    for (const prediction of this.predictions) {
      prediction.points = Match.scorePrediction(
        this.homeScore,
        this.awayScore,
        prediction.homeScore,
        prediction.awayScore,
        knockout,
      );
    }
  }
}

