import { Injectable, Logger } from '@nestjs/common';

/** A finished match result fetched from the external provider. */
export interface ProviderResult {
  /** Home team name already translated to the fixture's Spanish name. */
  homeTeam: string;
  /** Away team name already translated to the fixture's Spanish name. */
  awayTeam: string;
  /** Kickoff instant in UTC, when available (used to disambiguate). */
  kickoffUtc?: Date;
  homeScore: number;
  awayScore: number;
  /** Team that advanced via penalty shootout (only when scores are equal after AET). */
  penaltyWinner?: string;
}

/** Raw event shape returned by TheSportsDB `eventsseason.php`. */
interface SportsDbEvent {
  idEvent?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strStatus?: string | null;
  strTimestamp?: string | null;
  dateEvent?: string | null;
  /** Narrative result text, e.g. "Germany Won 4-2 on Penalties" (when available). */
  strResult?: string | null;
  /** Penalty score for the home team (when provided by the API). */
  intScoreVotes?: string | null;
}

/**
 * Maps TheSportsDB English team names to the Spanish names used in our fixture.
 * Keys are normalized (lowercase, no accents/punctuation) so several aliases
 * can point to the same Spanish name.
 */
const EN_TO_ES_TEAM: Record<string, string> = {
  mexico: 'México',
  southafrica: 'Sudáfrica',
  southkorea: 'Corea del Sur',
  korearepublic: 'Corea del Sur',
  czechrepublic: 'República Checa',
  czechia: 'República Checa',
  canada: 'Canadá',
  bosniaandherzegovina: 'Bosnia y Herzegovina',
  bosniaherzegovina: 'Bosnia y Herzegovina',
  qatar: 'Catar',
  switzerland: 'Suiza',
  brazil: 'Brasil',
  morocco: 'Marruecos',
  haiti: 'Haití',
  scotland: 'Escocia',
  unitedstates: 'Estados Unidos',
  usa: 'Estados Unidos',
  paraguay: 'Paraguay',
  australia: 'Australia',
  turkey: 'Turquía',
  turkiye: 'Turquía',
  germany: 'Alemania',
  curacao: 'Curazao',
  ivorycoast: 'Costa de Marfil',
  cotedivoire: 'Costa de Marfil',
  ecuador: 'Ecuador',
  netherlands: 'Países Bajos',
  holland: 'Países Bajos',
  japan: 'Japón',
  sweden: 'Suecia',
  tunisia: 'Túnez',
  belgium: 'Bélgica',
  egypt: 'Egipto',
  iran: 'Irán',
  newzealand: 'Nueva Zelanda',
  spain: 'España',
  capeverde: 'Cabo Verde',
  caboverde: 'Cabo Verde',
  saudiarabia: 'Arabia Saudita',
  uruguay: 'Uruguay',
  france: 'Francia',
  senegal: 'Senegal',
  iraq: 'Irak',
  norway: 'Noruega',
  argentina: 'Argentina',
  algeria: 'Argelia',
  austria: 'Austria',
  jordan: 'Jordania',
  portugal: 'Portugal',
  drcongo: 'RD Congo',
  congodr: 'RD Congo',
  democraticrepublicofthecongo: 'RD Congo',
  uzbekistan: 'Uzbekistán',
  colombia: 'Colombia',
  england: 'Inglaterra',
  croatia: 'Croacia',
  ghana: 'Ghana',
  panama: 'Panamá',
};

/** Lowercase, strip accents and any non-alphanumeric character. */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Fetches World Cup results from TheSportsDB, a free public sports data API.
 * No API key/registration required for the shared test key. Read-only HTTPS.
 *
 * Configurable via env:
 *  - THESPORTSDB_API_KEY  (default '3', the public test key)
 *  - THESPORTSDB_WC_LEAGUE_ID (default '4429', FIFA World Cup)
 *  - THESPORTSDB_WC_SEASON (default '2026')
 */
@Injectable()
export class WorldCupResultsProvider {
  private readonly logger = new Logger(WorldCupResultsProvider.name);

  private get apiKey(): string {
    return process.env.THESPORTSDB_API_KEY || '3';
  }

  private get leagueId(): string {
    return process.env.THESPORTSDB_WC_LEAGUE_ID || '4429';
  }

  private get season(): string {
    return process.env.THESPORTSDB_WC_SEASON || '2026';
  }

  /** Translate an English team name to the fixture's Spanish name, if known. */
  private translateTeam(englishName?: string | null): string | null {
    if (!englishName) return null;
    return EN_TO_ES_TEAM[normalizeName(englishName)] || null;
  }

  /**
   * Whether the status indicates the match is completely over (FT, AET, or penalty shootout).
   * All three are included so the result gets persisted with the correct 90-min score and,
   * for penalty matches, we attempt to extract the winner from provider metadata.
   */
  private isFinished(status?: string | null): boolean {
    if (!status) return false;
    const s = status.toLowerCase();
    return (
      s === 'ft' || s === 'aet' || s === 'ap' || s === 'pso' ||
      s.includes('full time') || s.includes('finished') ||
      s.includes('extra time') || s.includes('penalt')
    );
  }

  /** True when the status indicates the match was decided by penalties. */
  private isPenalty(status?: string | null): boolean {
    if (!status) return false;
    const s = status.toLowerCase();
    return s === 'ap' || s === 'pso' || (s.includes('penalt') && !s.includes('extra time'));
  }

  /**
   * Best-effort: try to determine which team won the penalty shootout from the
   * narrative `strResult` field TheSportsDB sometimes includes (e.g. "Germany Won 4-2
   * on Penalties"). Returns the Spanish team name if found, null otherwise.
   */
  private extractPenaltyWinner(
    event: SportsDbEvent,
    homeTeamEs: string,
    awayTeamEs: string,
  ): string | null {
    const raw = event.strResult ?? '';
    if (!raw) return null;
    const r = normalizeName(raw);
    if (!r.includes('won') && !r.includes('winner') && !r.includes('win')) return null;
    for (const [engKey, esName] of Object.entries(EN_TO_ES_TEAM)) {
      if (r.includes(engKey) && (esName === homeTeamEs || esName === awayTeamEs)) {
        return esName;
      }
    }
    return null;
  }

  /**
   * Returns the finished results for the configured World Cup season, with
   * team names translated to Spanish. Never throws: on any failure it logs and
   * returns an empty array so the caller (a cron job) keeps running.
   *
   * Uses `eventspastleague.php` (last ~15 past events for a league) which is
   * more reliable than `eventsseason.php` on the free API key: it returns
   * results without needing a season param and doesn't require full-season
   * indexing. Falls back to `eventsseason.php` if the primary URL returns
   * nothing so that results from earlier in the season are still picked up.
   */
  async fetchFinishedResults(): Promise<ProviderResult[]> {
    const urls = [
      `https://www.thesportsdb.com/api/v1/json/${this.apiKey}/eventspastleague.php?id=${this.leagueId}`,
      `https://www.thesportsdb.com/api/v1/json/${this.apiKey}/eventsseason.php?id=${this.leagueId}&s=${this.season}`,
    ];

    let events: SportsDbEvent[] = [];
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          this.logger.warn(`Results provider (${url}) responded ${response.status}; trying next.`);
          continue;
        }
        const data = (await response.json()) as { events?: SportsDbEvent[] | null };
        const fetched = data.events ?? [];
        if (fetched.length === 0) {
          this.logger.warn(`Results provider returned no events for URL: ${url}`);
          continue;
        }
        this.logger.log(`Results provider: ${fetched.length} event(s) fetched from ${url}`);
        events = fetched;
        break;
      } catch (err) {
        this.logger.warn(`Could not reach results provider (${url}): ${(err as Error).message}`);
      }
    }

    if (events.length === 0) return [];

    const results: ProviderResult[] = [];
    let skippedStatus = 0;
    let skippedScore = 0;
    let skippedTranslation = 0;

    for (const event of events) {
      if (!this.isFinished(event.strStatus)) { skippedStatus++; continue; }
      if (event.intHomeScore == null || event.intAwayScore == null) { skippedScore++; continue; }

      const homeScore = Number(event.intHomeScore);
      const awayScore = Number(event.intAwayScore);
      if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) { skippedScore++; continue; }

      const homeTeam = this.translateTeam(event.strHomeTeam);
      const awayTeam = this.translateTeam(event.strAwayTeam);
      if (!homeTeam || !awayTeam) {
        skippedTranslation++;
        this.logger.warn(
          `No translation for "${event.strHomeTeam}" vs "${event.strAwayTeam}" (status: ${event.strStatus ?? '?'}) — add to EN_TO_ES_TEAM map.`,
        );
        continue;
      }

      const kickoffUtc = event.strTimestamp ? new Date(`${event.strTimestamp.replace(' ', 'T')}Z`) : undefined;

      // For penalty matches (equal score after FT/AET), try to determine who advanced.
      let penaltyWinner: string | undefined;
      if (homeScore === awayScore && this.isPenalty(event.strStatus)) {
        penaltyWinner = this.extractPenaltyWinner(event, homeTeam, awayTeam) ?? undefined;
        if (penaltyWinner) {
          this.logger.log(`Penalty winner detected from provider: ${penaltyWinner}`);
        } else {
          this.logger.warn(`Could not determine penalty winner for ${homeTeam} vs ${awayTeam} — admin must set manually.`);
        }
      }

      results.push({ homeTeam, awayTeam, kickoffUtc, homeScore, awayScore, penaltyWinner });
    }

    this.logger.log(
      `Results provider parsed: ${results.length} usable, ${skippedStatus} not finished, ${skippedScore} missing score, ${skippedTranslation} untranslatable.`,
    );

    return results;
  }
}
