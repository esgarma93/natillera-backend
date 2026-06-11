import { Injectable, Inject, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { Match, MatchStatus, POINTS, PREDICTION_LOCK_HOURS } from '../domain/match.entity';
import { IMatchRepository, MATCH_REPOSITORY } from '../domain/match.repository';
import { IPollaGuestRepository, POLLA_GUEST_REPOSITORY } from '../domain/polla-guest.repository';
import { PollaGuest } from '../domain/polla-guest.entity';
import { PartnersService } from '../../partners/application/partners.service';
import { UsersService } from '../../users/application/users.service';
import { CreatePredictionDto } from './dto/create-prediction.dto';
import { CreateGuestDto } from './dto/create-guest.dto';
import { GuestResponseDto } from './dto/guest-response.dto';
import { SetMatchResultDto } from './dto/set-match-result.dto';
import { MatchResponseDto, RankingEntryDto, RankingResponseDto, PredictionReminder } from './dto/match-response.dto';
import { WORLD_CUP_2026_FIXTURE } from '../infrastructure/data/worldcup-2026-fixture';
import { computePollaPrizes } from '../domain/polla-prizes';
import { toColombiaDate } from '../../whatsapp/application/whatsapp.utils';

@Injectable()
export class PollaService implements OnModuleInit {
  private readonly logger = new Logger(PollaService.name);

  constructor(
    @Inject(MATCH_REPOSITORY)
    private readonly matchRepository: IMatchRepository,
    @Inject(POLLA_GUEST_REPOSITORY)
    private readonly guestRepository: IPollaGuestRepository,
    private readonly partnersService: PartnersService,
    private readonly usersService: UsersService,
  ) {}

  /** Seed the World Cup fixture the first time the module boots. */
  async onModuleInit(): Promise<void> {
    try {
      const existing = await this.matchRepository.count();
      if (existing > 0) {
        return;
      }
      this.logger.log('Seeding World Cup 2026 fixture...');
      const now = new Date();
      for (const fixture of WORLD_CUP_2026_FIXTURE) {
        const date = new Date(fixture.date);
        const match = new Match({
          matchNumber: fixture.matchNumber,
          phase: fixture.phase,
          group: fixture.group,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          stadium: fixture.stadium,
          city: fixture.city,
          date,
          status: this.computeStatus(date, now),
          predictions: [],
        });
        await this.matchRepository.create(match);
      }
      this.logger.log(`Seeded ${WORLD_CUP_2026_FIXTURE.length} matches.`);
    } catch (err) {
      this.logger.error('Failed to seed World Cup fixture', err as Error);
    }
  }

  async findAll(): Promise<MatchResponseDto[]> {
    const matches = await this.matchRepository.findAll();
    return matches.map(m => this.toResponseDto(m));
  }

  async findByPhase(phase: string): Promise<MatchResponseDto[]> {
    const matches = await this.matchRepository.findByPhase(phase);
    return matches.map(m => this.toResponseDto(m));
  }

  async findById(id: string): Promise<MatchResponseDto> {
    const match = await this.matchRepository.findById(id);
    if (!match) throw new NotFoundException(`Match ${id} not found`);
    return this.toResponseDto(match);
  }

  /** Submit or update a prediction for a match (partner or guest), locks 1h before kickoff. */
  async submitPrediction(matchId: string, dto: CreatePredictionDto): Promise<MatchResponseDto> {
    const match = await this.matchRepository.findById(matchId);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);

    if (!match.teamsDefined()) {
      throw new BadRequestException(
        'Aún no se conocen los equipos de este partido. Podrás predecir cuando se definan.',
      );
    }

    if (!match.allowsPrediction(new Date())) {
      throw new BadRequestException(
        'El plazo para registrar tu predicción ya cerró (1 hora antes del partido).',
      );
    }

    let participantName: string;
    let invitedByPartnerId: string | undefined;
    if (dto.isGuest) {
      const guest = await this.guestRepository.findById(dto.partnerId);
      if (!guest) throw new NotFoundException(`Guest ${dto.partnerId} not found`);
      participantName = guest.nombre;
      invitedByPartnerId = guest.invitedByPartnerId;
    } else {
      const partner = await this.partnersService.findById(dto.partnerId);
      participantName = partner.nombre;
    }

    const now = new Date();
    const existing = match.predictions.find(p => p.partnerId === dto.partnerId);
    if (existing) {
      existing.homeScore = dto.homeScore;
      existing.awayScore = dto.awayScore;
      existing.updatedAt = now;
    } else {
      match.predictions.push({
        partnerId: dto.partnerId,
        partnerName: participantName,
        isGuest: dto.isGuest || false,
        invitedByPartnerId,
        homeScore: dto.homeScore,
        awayScore: dto.awayScore,
        points: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    const updated = await this.matchRepository.update(matchId, {
      predictions: match.predictions,
    });
    return this.toResponseDto(updated!);
  }

  /** Register the final result of a match and score every prediction (admin). */
  async setResult(matchId: string, dto: SetMatchResultDto): Promise<MatchResponseDto> {
    const match = await this.matchRepository.findById(matchId);
    if (!match) throw new NotFoundException(`Match ${matchId} not found`);

    match.homeScore = dto.homeScore;
    match.awayScore = dto.awayScore;
    match.status = MatchStatus.FINISHED;
    match.recalculatePredictionPoints();

    const updated = await this.matchRepository.update(matchId, {
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      predictions: match.predictions,
    });
    return this.toResponseDto(updated!);
  }

  /** Aggregate every partner's points across all scored matches, with prizes. */
  async getRanking(): Promise<RankingResponseDto> {
    const matches = await this.matchRepository.findAll();
    const partners = await this.partnersService.findAll();
    const guests = await this.guestRepository.findAll();
    const byPartner = new Map<string, RankingEntryDto>();

    // Seed the ranking with every participant so the list is complete even
    // before anyone registers a prediction.
    const seedEntry = (id: string, name: string, isGuest: boolean) => {
      byPartner.set(id, {
        position: 0,
        partnerId: id,
        partnerName: name,
        isGuest,
        points: 0,
        predictions: 0,
        exactHits: 0,
        outcomeHits: 0,
        prize: 0,
      });
    };
    for (const partner of partners) {
      if (partner.activo) seedEntry(partner.id!, partner.nombre, false);
    }
    for (const guest of guests) {
      if (guest.activo) seedEntry(guest.id!, guest.nombre, true);
    }

    for (const match of matches) {
      const scored = match.status === MatchStatus.FINISHED;
      const tier = match.isKnockout() ? 'knockout' : 'group';
      const maxPoints =
        POINTS.OUTCOME[tier] +
        POINTS.HOME_GOALS[tier] +
        POINTS.AWAY_GOALS[tier] +
        POINTS.GOAL_DIFFERENCE[tier];
      const outcomePoints = POINTS.OUTCOME[tier];

      for (const prediction of match.predictions) {
        let entry = byPartner.get(prediction.partnerId);
        if (!entry) {
          // Prediction from a partner/guest no longer active: still count it.
          entry = {
            position: 0,
            partnerId: prediction.partnerId,
            partnerName: prediction.partnerName,
            isGuest: prediction.isGuest || false,
            points: 0,
            predictions: 0,
            exactHits: 0,
            outcomeHits: 0,
            prize: 0,
          };
          byPartner.set(prediction.partnerId, entry);
        }
        entry.predictions += 1;
        if (scored) {
          entry.points += prediction.points;
          // Exact score: earned the maximum for the phase.
          if (prediction.points >= maxPoints) entry.exactHits += 1;
          // Correct outcome: earned at least the outcome component.
          if (prediction.points >= outcomePoints) entry.outcomeHits += 1;
        }
      }
    }

    const ranking = Array.from(byPartner.values()).sort(
      (a, b) =>
        b.points - a.points ||
        b.exactHits - a.exactHits ||
        a.partnerName.localeCompare(b.partnerName),
    );

    // Prize pool is based on everyone in the polla: active partners + active guests.
    const participants =
      partners.filter(p => p.activo).length + guests.filter(g => g.activo).length;
    const prizes = computePollaPrizes(participants);

    ranking.forEach((entry, index) => {
      entry.position = index + 1;
      if (index === 0) entry.prize = prizes.firstPlacePrize;
      else if (index === 1) entry.prize = prizes.secondPlacePrize;
      else entry.prize = 0;
    });

    return { ranking, prizes };
  }

  // ---- Guests (invitados) ----

  /** List every guest invited to the polla. */
  async findAllGuests(): Promise<GuestResponseDto[]> {
    const guests = await this.guestRepository.findAll();
    return guests.map(g => this.toGuestDto(g));
  }

  /** Invite a guest to the polla (invited by a partner). */
  async createGuest(dto: CreateGuestDto): Promise<GuestResponseDto> {
    const partner = await this.partnersService.findById(dto.invitedByPartnerId);
    const guest = await this.guestRepository.create(
      new PollaGuest({
        nombre: dto.nombre.trim(),
        invitedByPartnerId: dto.invitedByPartnerId,
        invitedByName: partner.nombre,
        activo: true,
      }),
    );
    return this.toGuestDto(guest);
  }

  /** Remove a guest and delete all of their predictions. */
  async deleteGuest(guestId: string): Promise<void> {
    const guest = await this.guestRepository.findById(guestId);
    if (!guest) throw new NotFoundException(`Guest ${guestId} not found`);

    const matches = await this.matchRepository.findAll();
    for (const match of matches) {
      const before = match.predictions.length;
      const filtered = match.predictions.filter(p => p.partnerId !== guestId);
      if (filtered.length !== before) {
        await this.matchRepository.update(match.id!, { predictions: filtered });
      }
    }

    await this.guestRepository.delete(guestId);
  }

  private toGuestDto(guest: PollaGuest): GuestResponseDto {
    return {
      id: guest.id!,
      nombre: guest.nombre,
      invitedByPartnerId: guest.invitedByPartnerId,
      invitedByName: guest.invitedByName,
      activo: guest.activo,
    };
  }

  /**
   * Lock matches whose kickoff is within the next hour (PREDICTION_LOCK_HOURS).
   * Returns how many were locked. Called by the scheduled job.
   */
  async lockExpiredMatches(now: Date = new Date()): Promise<number> {
    const matches = await this.matchRepository.findAll();
    let locked = 0;
    for (const match of matches) {
      if (match.status === MatchStatus.OPEN && now >= match.getLockTime()) {
        await this.matchRepository.update(match.id!, { status: MatchStatus.CLOSED });
        locked += 1;
      }
    }
    if (locked > 0) {
      this.logger.log(`Locked ${locked} match(es) past their prediction deadline.`);
    }
    return locked;
  }

  /**
   * Find active partners (with phone) who still have no prediction for matches
   * kicking off within the next 24–48h. Used by the WhatsApp 48h reminder job.
   * Returns one entry per partner with the list of matches they are missing.
   */
  async getMissingPredictionReminders(now: Date = new Date()): Promise<PredictionReminder[]> {
    const from = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const matches = await this.matchRepository.findByDateRange(from, to);

    // Only matches that can still be predicted (real teams, not finished).
    const upcoming = matches.filter(
      m => m.teamsDefined() && m.status !== MatchStatus.FINISHED,
    );
    if (upcoming.length === 0) return [];

    const partners = await this.partnersService.findAll();
    const activePartners = partners.filter(p => p.activo && p.celular);

    const reminders: PredictionReminder[] = [];
    for (const partner of activePartners) {
      const missing = upcoming.filter(
        m => !m.predictions.some(pr => pr.partnerId === partner.id && !pr.isGuest),
      );
      if (missing.length > 0) {
        reminders.push({
          partnerId: partner.id!,
          partnerName: partner.nombre,
          celular: partner.celular!,
          matches: missing.map(m => ({
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            date: m.date,
          })),
        });
      }
    }
    return reminders;
  }

  /**
   * Consolidate the points for every finished match played on the given day
   * (Colombia time) and persist them, so the ranking is always up to date.
   * Partners with no prediction simply score 0 (they hold no prediction record).
   * Called by the end-of-day scheduled job.
   */
  async consolidateDailyResults(now: Date = new Date()): Promise<number> {
    const { from, to } = this.colombiaDayBounds(now);
    const matches = await this.matchRepository.findByDateRange(from, to);
    let consolidated = 0;

    for (const match of matches) {
      if (
        match.status !== MatchStatus.FINISHED ||
        match.homeScore === undefined ||
        match.awayScore === undefined
      ) {
        continue;
      }
      match.recalculatePredictionPoints();
      await this.matchRepository.update(match.id!, { predictions: match.predictions });
      consolidated += 1;
    }

    if (consolidated > 0) {
      this.logger.log(`Consolidated points for ${consolidated} finished match(es) today.`);
    }
    return consolidated;
  }

  /** UTC bounds [from, to) covering the Colombian calendar day of `now`. */
  private colombiaDayBounds(now: Date): { from: Date; to: Date } {
    const local = toColombiaDate(now);
    // Colombia is UTC-5 (no DST): local midnight = 05:00 UTC the same date.
    const from = new Date(
      Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 5, 0, 0, 0),
    );
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    return { from, to };
  }

  private computeStatus(date: Date, now: Date): MatchStatus {
    const lockTime = new Date(date.getTime() - PREDICTION_LOCK_HOURS * 60 * 60 * 1000);
    return now >= lockTime ? MatchStatus.CLOSED : MatchStatus.OPEN;
  }

  private toResponseDto(match: Match): MatchResponseDto {
    return {
      id: match.id!,
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
      predictions: match.predictions,
      allowsPrediction: match.allowsPrediction(new Date()),
      teamsDefined: match.teamsDefined(),
      lockTime: match.getLockTime(),
    };
  }
}
