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

  /** A status string that indicates the match has finished. */
  private isFinished(status?: string | null): boolean {
    if (!status) return false;
    const s = status.toLowerCase();
    return s.includes('finished') || s === 'ft' || s.includes('full time') || s.includes('aet') || s.includes('pen');
  }

  /**
   * Returns the finished results for the configured World Cup season, with
   * team names translated to Spanish. Never throws: on any failure it logs and
   * returns an empty array so the caller (a cron job) keeps running.
   */
  async fetchFinishedResults(): Promise<ProviderResult[]> {
    const url = `https://www.thesportsdb.com/api/v1/json/${this.apiKey}/eventsseason.php?id=${this.leagueId}&s=${this.season}`;
    let events: SportsDbEvent[];
    try {
      const response = await fetch(url);
      if (!response.ok) {
        this.logger.warn(`Results provider responded ${response.status}; skipping.`);
        return [];
      }
      const data = (await response.json()) as { events?: SportsDbEvent[] | null };
      events = data.events || [];
    } catch (err) {
      this.logger.warn(`Could not reach results provider: ${(err as Error).message}`);
      return [];
    }

    const results: ProviderResult[] = [];
    for (const event of events) {
      if (!this.isFinished(event.strStatus)) continue;
      if (event.intHomeScore == null || event.intAwayScore == null) continue;

      const homeScore = Number(event.intHomeScore);
      const awayScore = Number(event.intAwayScore);
      if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue;

      const homeTeam = this.translateTeam(event.strHomeTeam);
      const awayTeam = this.translateTeam(event.strAwayTeam);
      if (!homeTeam || !awayTeam) continue;

      const kickoffUtc = event.strTimestamp ? new Date(`${event.strTimestamp.replace(' ', 'T')}Z`) : undefined;

      results.push({ homeTeam, awayTeam, kickoffUtc, homeScore, awayScore });
    }

    return results;
  }
}
