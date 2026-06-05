import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PollaService } from './polla.service';

/**
 * Scheduled jobs for the Polla:
 *  - Lock matches once they are within 24h of kickoff (no more predictions).
 *  - Consolidate the day's results every night so the ranking stays up to date.
 */
@Injectable()
export class PollaCronHandler {
  private readonly logger = new Logger(PollaCronHandler.name);

  constructor(private readonly pollaService: PollaService) {}

  /** Runs every 10 minutes to keep the 24h prediction window accurate. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async lockMatchesPastDeadline(): Promise<void> {
    try {
      await this.pollaService.lockExpiredMatches(new Date());
    } catch (err) {
      this.logger.error('Failed to lock matches past deadline', err as Error);
    }
  }

  /**
   * Runs nightly at 23:30 Colombia time to consolidate and persist the points
   * of every finished match played during the day.
   */
  @Cron('30 23 * * *', { timeZone: 'America/Bogota' })
  async consolidateDailyResults(): Promise<void> {
    try {
      await this.pollaService.consolidateDailyResults(new Date());
    } catch (err) {
      this.logger.error('Failed to consolidate daily results', err as Error);
    }
  }
}
