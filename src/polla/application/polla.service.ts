import { Injectable, Inject, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { Match, MatchStatus, POINTS, PREDICTION_LOCK_MINUTES } from '../domain/match.entity';
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
import { WorldCupResultsProvider } from '../infrastructure/providers/worldcup-results.provider';
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
    private readonly resultsProvider: WorldCupResultsProvider,
  ) {}

  /** Seed the World Cup fixture on first boot; sync confirmed team names on subsequent boots. */
  async onModuleInit(): Promise<void> {
    try {
      const count = await this.matchRepository.count();
      if (count === 0) {
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
        return;
      }
      // Sync team names: when the fixture now has real teams but the DB still has
      // placeholder names (e.g. '1.º Grupo A'), update only those fields so that
      // teamsDefined() returns true and predictions can open.
      let synced = 0;
      for (const fixture of WORLD_CUP_2026_FIXTURE) {
        const hasRealHome = Match.isTeamDefined(fixture.homeTeam);
        const hasRealAway = Match.isTeamDefined(fixture.awayTeam);
        if (!hasRealHome && !hasRealAway) continue;
        const dbMatch = await this.matchRepository.findByMatchNumber(fixture.matchNumber);
        if (!dbMatch) continue;
        const update: Partial<Match> = {};
        if (hasRealHome && !Match.isTeamDefined(dbMatch.homeTeam)) update.homeTeam = fixture.homeTeam;
        if (hasRealAway && !Match.isTeamDefined(dbMatch.awayTeam)) update.awayTeam = fixture.awayTeam;
        if (Object.keys(update).length > 0) {
          await this.matchRepository.update(dbMatch.id!, update);
          synced++;
        }
      }
      if (synced > 0) {
        this.logger.log(`Synced team names for ${synced} match(es) from fixture.`);
      }
    } catch (err) {
      this.logger.error('Failed to seed/sync World Cup fixture', err as Error);
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
        'El plazo para registrar tu predicción ya cerró (15 minutos antes del partido).',
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
   * Lock matches whose kickoff is within the next PREDICTION_LOCK_MINUTES.
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
   * kicking off in the next 45–60 minutes. Used by the 1h-before WhatsApp
   * reminder job, which runs every 15 min so each kickoff falls into exactly
   * one window and partners are notified at most once per match.
   */
  async getMissingPredictionReminders(now: Date = new Date()): Promise<PredictionReminder[]> {
    const from = new Date(now.getTime() + 45 * 60 * 1000);
    const to = new Date(now.getTime() + 60 * 60 * 1000);
    const matches = await this.matchRepository.findByDateRange(from, to);

    // Only matches that can still be predicted (real teams, not finished).
    const upcoming = matches.filter(
      m => m.teamsDefined() && m.status !== MatchStatus.FINISHED,
    );
    if (upcoming.length === 0) return [];

    const partners = await this.partnersService.findAll();

    // Resolve a phone for each partner: prefer the partner record, fall back to
    // the linked user account's phone (some partners have no celular set there).
    const users = await this.usersService.findAll();
    const userPhoneByPartner = new Map<string, string>();
    for (const u of users) {
      if (u.partnerId && u.celular) userPhoneByPartner.set(u.partnerId, u.celular);
    }
    const resolvePhone = (partner: { id?: string; celular?: string }): string | undefined =>
      partner.celular || (partner.id ? userPhoneByPartner.get(partner.id) : undefined);

    const activePartners = partners.filter(p => p.activo && resolvePhone(p));

    const reminders: PredictionReminder[] = [];
    for (const partner of activePartners) {
      const missing = upcoming.filter(
        m => !m.predictions.some(pr => pr.partnerId === partner.id && !pr.isGuest),
      );
      if (missing.length > 0) {
        reminders.push({
          partnerId: partner.id!,
          partnerName: partner.nombre,
          celular: resolvePhone(partner)!,
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

  /**
   * Fetch finished results from the external provider (TheSportsDB) and apply
   * them to the matching fixtures, marking them as finished and recalculating
   * points. Matching is by normalized team names; when several fixtures share
   * the same pairing, the kickoff closest to the provider's timestamp is used.
   * Already-finished matches with the same score are skipped. Never throws.
   */
  async syncResultsFromProvider(): Promise<number> {
    const providerResults = await this.resultsProvider.fetchFinishedResults();
    if (providerResults.length === 0) return 0;

    const matches = await this.matchRepository.findAll();
    const normalize = (value: string): string =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    // Index our matches by the normalized "home|away" pairing.
    const byPairing = new Map<string, Match[]>();
    for (const match of matches) {
      const key = `${normalize(match.homeTeam)}|${normalize(match.awayTeam)}`;
      const list = byPairing.get(key);
      if (list) list.push(match);
      else byPairing.set(key, [match]);
    }

    let applied = 0;
    for (const result of providerResults) {
      const key = `${normalize(result.homeTeam)}|${normalize(result.awayTeam)}`;
      const candidates = byPairing.get(key);
      if (!candidates || candidates.length === 0) continue;

      // Pick the fixture whose kickoff is closest to the provider's timestamp.
      let match = candidates[0];
      if (candidates.length > 1 && result.kickoffUtc) {
        const target = result.kickoffUtc.getTime();
        match = candidates.reduce((best, current) =>
          Math.abs(current.date.getTime() - target) < Math.abs(best.date.getTime() - target)
            ? current
            : best,
        );
      }

      // Skip if already finished with the same score (idempotent).
      if (
        match.status === MatchStatus.FINISHED &&
        match.homeScore === result.homeScore &&
        match.awayScore === result.awayScore
      ) {
        continue;
      }

      match.homeScore = result.homeScore;
      match.awayScore = result.awayScore;
      match.status = MatchStatus.FINISHED;
      match.recalculatePredictionPoints();
      await this.matchRepository.update(match.id!, {
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        status: match.status,
        predictions: match.predictions,
      });
      applied += 1;
    }

    if (applied > 0) {
      this.logger.log(`Auto-applied ${applied} result(s) from the external provider.`);
    }
    return applied;
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
    const lockTime = new Date(date.getTime() - PREDICTION_LOCK_MINUTES * 60 * 1000);
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
