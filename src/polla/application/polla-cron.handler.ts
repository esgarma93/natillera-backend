import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PollaService } from './polla.service';

/**
 * Scheduled jobs for the Polla:
 *  - Lock matches once they are within 15min of kickoff (no more predictions).
 *  - Consolidate the day's results every 30 min (4 PM–midnight) so the ranking stays up to date.
 */
@Injectable()
export class PollaCronHandler {
  private readonly logger = new Logger(PollaCronHandler.name);

  constructor(private readonly pollaService: PollaService) {}

  /** Runs every 10 minutes to keep the prediction lock window accurate. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async lockMatchesPastDeadline(): Promise<void> {
    try {
      await this.pollaService.lockExpiredMatches(new Date());
    } catch (err) {
      this.logger.error('Failed to lock matches past deadline', err as Error);
    }
  }

  /**
   * During the World Cup, matches finish in the evening (Colombia time). This
   * runs every 30 minutes from 4:00 PM to 11:30 PM Colombia time so the ranking
   * stays up to date shortly after each match ends. The consolidation is
   * idempotent (it only recalculates points of already-finished matches).
   */
  @Cron('*/30 16-23 * * *', { timeZone: 'America/Bogota' })
  async consolidateDailyResults(): Promise<void> {
    try {
      await this.pollaService.consolidateDailyResults(new Date());
    } catch (err) {
      this.logger.error('Failed to consolidate daily results', err as Error);
    }
  }
}
