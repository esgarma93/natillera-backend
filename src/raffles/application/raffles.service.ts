import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MonthlyRaffle, RaffleStatus } from '../domain/monthly-raffle.entity';
import { MonthlyRaffleRepository } from '../domain/monthly-raffle.repository';
import { MonthlyRaffleResponseDto } from './dto/monthly-raffle-response.dto';
import { PartnersService } from '../../partners/application/partners.service';
import { PaymentsService } from '../../payments/application/payments.service';
import { WhatsAppService } from '../../whatsapp/application/whatsapp.service';
import { UsersService } from '../../users/application/users.service';
import { UserRole } from '../../users/domain/user.entity';
import * as cheerio from 'cheerio';

@Injectable()
export class RafflesService {
  private readonly logger = new Logger(RafflesService.name);
  private readonly RAFFLE_FEE = 7000; // $7,000 fijos por socio

  private readonly MONTH_NAMES = [
    '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  constructor(
    @Inject('MonthlyRaffleRepository')
    private readonly raffleRepository: MonthlyRaffleRepository,
    private readonly partnersService: PartnersService,
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Get last Friday of a month
   */
  private getLastFridayOfMonth(month: number, year: number): Date {
    // Get last day of month
    const lastDay = new Date(year, month, 0);
    const lastDayNum = lastDay.getDate();
    
    // Find last Friday
    for (let day = lastDayNum; day >= lastDayNum - 6; day--) {
      const date = new Date(year, month - 1, day);
      if (date.getDay() === 5) { // Friday is 5
        return date;
      }
    }
    
    // Fallback (should never happen)
    return lastDay;
  }

  /**
   * Get Saturday after last Friday of month
   */
  private getSaturdayAfterLastFriday(month: number, year: number): Date {
    const lastFriday = this.getLastFridayOfMonth(month, year);
    const saturday = new Date(lastFriday);
    saturday.setDate(saturday.getDate() + 1);
    saturday.setHours(0, 0, 0, 0);
    return saturday;
  }

  /**
   * Calculate total collected for a month.
   * Total = RAFFLE_FEE × number of active partners (regardless of payment status).
   */
  private async calculateTotalCollected(month: number, year: number): Promise<number> {
    const partners = await this.partnersService.findAll();
    const activePartners = partners.filter(p => p.activo);

    return activePartners.length * this.RAFFLE_FEE;
  }

  /**
   * Find winner by matching last 2 digits with partner's raffle number.
   * Only active partners who have paid this month are eligible.
   */
  private async findWinner(winningDigits: string, month: number, year: number) {
    // Get all active partners
    const partners = await this.partnersService.findAll();
    const activePartners = partners.filter(p => p.activo);

    // Check if they have paid this month
    const payments = await this.paymentsService.findByMonthAndYear(month, year);
    
    for (const partner of activePartners) {
      // Check if partner paid this month
      const hasPaid = payments.some(p => 
        p.partnerId === partner.id && p.status === 'verified'
      );

      if (!hasPaid) continue;

      // Check if last 2 digits of partner's raffle number match
      const raffleNumber = partner.numeroRifa?.toString() || '';
      const lastTwoDigits = raffleNumber.slice(-2).padStart(2, '0');

      if (lastTwoDigits === winningDigits) {
        return {
          winnerId: partner.id,
          winnerName: partner.nombre,
          winnerRaffleNumber: partner.numeroRifa?.toString(),
          winnerCelular: partner.celular,
        };
      }
    }

    return null;
  }

  /**
   * Fetch winning number from Lotería de Medellín
   */
  private async fetchLotteryNumber(): Promise<string | null> {
    try {
      const response = await fetch('https://loteriademedellin.com.co/resultados/');
      const html = await response.text();
      
      const $ = cheerio.load(html);
      const jackpotNumber = $('.elementor-lottery-jackpot-number').first().text().trim();
      
      if (jackpotNumber) {
        this.logger.log(`Fetched lottery number: ${jackpotNumber}`);
        return jackpotNumber;
      }
      
      return null;
    } catch (error) {
      this.logger.error('Error fetching lottery number:', error);
      return null;
    }
  }

  /**
   * Process raffle draw for a specific month
   */
  async processRaffleDraw(month: number, year: number): Promise<MonthlyRaffle> {
    this.logger.log(`Processing raffle draw for ${this.MONTH_NAMES[month]} ${year}`);

    // Check if raffle already exists
    let raffle = await this.raffleRepository.findByMonthAndYear(month, year);
    
    if (raffle && raffle.status !== RaffleStatus.PENDING) {
      this.logger.warn(`Raffle for ${month}/${year} already processed`);
      return raffle;
    }

    // Fetch lottery number
    const lotteryNumber = await this.fetchLotteryNumber();
    
    if (!lotteryNumber) {
      throw new Error('Could not fetch lottery number');
    }

    // Extract last 2 digits
    const winningDigits = lotteryNumber.slice(-2);

    // Calculate total collected
    const totalCollected = await this.calculateTotalCollected(month, year);

    // Find winner
    const winner = await this.findWinner(winningDigits, month, year);

    // Prize only applies if there is a winner (50/50 split)
    // If no winner, everything stays in the natillera
    const prizeAmount = winner ? Math.floor(totalCollected / 2) : 0;
    const remainingAmount = totalCollected - prizeAmount;

    const raffleData = {
      lotteryNumber,
      winningDigits,
      totalCollected,
      prizeAmount,
      remainingAmount,
      winnerId: winner?.winnerId,
      winnerName: winner?.winnerName,
      winnerRaffleNumber: winner?.winnerRaffleNumber,
      status: winner ? RaffleStatus.COMPLETED : RaffleStatus.NO_WINNER,
    };

    if (raffle) {
      // Update existing
      raffle = await this.raffleRepository.update(raffle.id!, raffleData);
    } else {
      // Create new
      const raffleDate = this.getLastFridayOfMonth(month, year);
      const drawDate = this.getSaturdayAfterLastFriday(month, year);

      raffle = await this.raffleRepository.create(new MonthlyRaffle({
        month,
        year,
        raffleDate,
        drawDate,
        ...raffleData,
      }));
    }

    if (winner) {
      this.logger.log(
        `Winner found! ${winner.winnerName} (#${winner.winnerRaffleNumber}) wins $${prizeAmount.toLocaleString()}`
      );

      const monthName = this.MONTH_NAMES[month];

      // Notify winner via WhatsApp if they have a registered phone number
      if (winner.winnerCelular) {
        try {
          const whatsappNumber = `57${winner.winnerCelular.replace(/\D/g, '')}`;

          await this.whatsAppService.sendMessage(
            whatsappNumber,
            `🎉 *¡FELICITACIONES, ${winner.winnerName}!* 🎉\n\n` +
            `🏆 *¡Eres el ganador de la rifa de ${monthName} ${year}!*\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🎰 Tu número de rifa: *#${winner.winnerRaffleNumber}*\n` +
            `🔢 Número ganador Lotería Medellín: *${lotteryNumber}*\n` +
            `💰 Premio: *$${prizeAmount.toLocaleString('es-CO')}*\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `El administrador se pondrá en contacto contigo para hacer entrega del premio. 🤝\n\n` +
            `_— Nacho, asistente de Natillera Chimba Verde 🌿_`,
          );

          this.logger.log(`Winner notification sent to ${winner.winnerName} (${whatsappNumber})`);
        } catch (notifyError) {
          this.logger.error(`Failed to send winner notification to ${winner.winnerName}:`, notifyError);
        }
      } else {
        this.logger.warn(`Winner ${winner.winnerName} has no registered phone number — WhatsApp notification skipped`);
      }

      // Notify all admins about the winner
      try {
        const adminPhones = await this.getAdminPhones();
        for (const adminPhone of adminPhones) {
          await this.whatsAppService.sendMessage(
            adminPhone,
            `🏆 *¡Tenemos ganador!*\n\n` +
            `Se realizó el sorteo de *${monthName} ${year}* y tenemos ganador.\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👤 Ganador: *${winner.winnerName}*\n` +
            `🎰 Número de rifa: *#${winner.winnerRaffleNumber}*\n` +
            `📱 Cel: *${winner.winnerCelular || 'No registrado'}*\n` +
            `🔢 Número Lotería Medellín: *${lotteryNumber}*\n` +
            `💰 Premio: *$${prizeAmount.toLocaleString('es-CO')}*\n` +
            `💰 Recaudado total: *$${totalCollected.toLocaleString('es-CO')}*\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `_— Nacho, asistente de Natillera Chimba Verde 🌿_`,
          );
        }
        this.logger.log(`Winner notification sent to ${adminPhones.length} admin(s)`);
      } catch (notifyError) {
        this.logger.error('Failed to send winner notification to admins:', notifyError);
      }
    } else {
      this.logger.log(`No winner for ${month}/${year}. Amount remains in natillera: $${remainingAmount.toLocaleString()}`);

      // Notify all admins when there's no winner
      try {
        const adminPhones = await this.getAdminPhones();
        const monthName = this.MONTH_NAMES[month];

        for (const adminPhone of adminPhones) {
          await this.whatsAppService.sendMessage(
            adminPhone,
            `😔 *Sin ganador este mes*\n\n` +
            `Se realizó el sorteo de *${monthName} ${year}* y no hubo ganador.\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🔢 Número Lotería Medellín: *${lotteryNumber}*\n` +
            `🎰 Últimas dos cifras: *${winningDigits}*\n` +
            `💰 Monto que queda en la natillera: *$${remainingAmount.toLocaleString('es-CO')}*\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `El 100% del recaudo queda en la natillera. 🏦\n\n` +
            `_— Nacho, asistente de Natillera Chimba Verde 🌿_`,
          );
        }

        this.logger.log(`No-winner notification sent to ${adminPhones.length} admin(s)`);
      } catch (notifyError) {
        this.logger.error('Failed to send no-winner notification to admins:', notifyError);
      }
    }

    return raffle!;
  }

  /**
   * Cron job: Run every Saturday at 10:00 AM to check if it's the Saturday after last Friday of the month.
   * Checks both current month (when last Friday falls on the last day) and previous month.
   */
  @Cron('0 10 * * 6') // Every Saturday at 10:00 AM
  async handleRaffleDraw() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Check current month first: is today the Saturday after the last Friday of this month?
    const expectedSaturdayCurrent = this.getSaturdayAfterLastFriday(currentMonth, currentYear);
    const isCurrentMonthDay =
      now.getDate() === expectedSaturdayCurrent.getDate() &&
      now.getMonth() === expectedSaturdayCurrent.getMonth() &&
      now.getFullYear() === expectedSaturdayCurrent.getFullYear();

    if (isCurrentMonthDay) {
      this.logger.log(`Running automatic raffle draw for ${this.MONTH_NAMES[currentMonth]} ${currentYear}`);
      try {
        await this.processRaffleDraw(currentMonth, currentYear);
      } catch (error) {
        this.logger.error(`Error processing automatic raffle draw:`, error);
      }
      return;
    }

    // Check previous month: is today the Saturday after the last Friday of previous month?
    const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const previousYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const expectedSaturdayPrev = this.getSaturdayAfterLastFriday(previousMonth, previousYear);
    const isPreviousMonthDay =
      now.getDate() === expectedSaturdayPrev.getDate() &&
      now.getMonth() === expectedSaturdayPrev.getMonth() &&
      now.getFullYear() === expectedSaturdayPrev.getFullYear();

    if (isPreviousMonthDay) {
      this.logger.log(`Running automatic raffle draw for ${this.MONTH_NAMES[previousMonth]} ${previousYear}`);
      try {
        await this.processRaffleDraw(previousMonth, previousYear);
      } catch (error) {
        this.logger.error(`Error processing automatic raffle draw:`, error);
      }
    } else {
      this.logger.debug(`Today is not raffle draw day. Checked: ${expectedSaturdayCurrent.toDateString()} and ${expectedSaturdayPrev.toDateString()}`);
    }
  }

  /**
   * Get all raffles
   */
  async findAll(): Promise<MonthlyRaffleResponseDto[]> {
    const raffles = await this.raffleRepository.findAll();
    return raffles.map(r => this.toResponseDto(r));
  }

  /**
   * Get raffles by year
   */
  async findByYear(year: number): Promise<MonthlyRaffleResponseDto[]> {
    const raffles = await this.raffleRepository.findByYear(year);
    return raffles.map(r => this.toResponseDto(r));
  }

  /**
   * Get raffle by month and year
   */
  async findByMonthAndYear(month: number, year: number): Promise<MonthlyRaffleResponseDto | null> {
    const raffle = await this.raffleRepository.findByMonthAndYear(month, year);
    return raffle ? this.toResponseDto(raffle) : null;
  }

  /**
   * Manually trigger raffle draw (for admin)
   */
  async triggerRaffleDraw(month: number, year: number): Promise<MonthlyRaffleResponseDto> {
    const raffle = await this.processRaffleDraw(month, year);
    return this.toResponseDto(raffle);
  }

  /**
   * Return the list of admin phone numbers from the DB (users with role ADMIN).
   * Phone numbers are returned in WhatsApp E.164 format (e.g. "573122249196").
   */
  private async getAdminPhones(): Promise<string[]> {
    const admins = await this.usersService.findByRole(UserRole.ADMIN);
    return admins
      .map(u => u.celular ? `57${u.celular}` : '')
      .filter(p => p.length > 0);
  }

  /**
   * Get raffle statistics
   */
  async getRaffleStats(year: number): Promise<{
    totalCollected: number;
    totalPrizes: number;
    totalRemaining: number;
    rafflesWithWinner: number;
    rafflesWithoutWinner: number;
  }> {
    const raffles = await this.raffleRepository.findByYear(year);
    
    return {
      totalCollected: raffles.reduce((sum, r) => sum + r.totalCollected, 0),
      totalPrizes: raffles.reduce((sum, r) => sum + r.prizeAmount, 0),
      totalRemaining: raffles.reduce((sum, r) => sum + r.remainingAmount, 0),
      rafflesWithWinner: raffles.filter(r => r.status === RaffleStatus.COMPLETED).length,
      rafflesWithoutWinner: raffles.filter(r => r.status === RaffleStatus.NO_WINNER).length,
    };
  }

  private toResponseDto(raffle: MonthlyRaffle): MonthlyRaffleResponseDto {
    return {
      id: raffle.id!,
      month: raffle.month,
      monthName: this.MONTH_NAMES[raffle.month],
      year: raffle.year,
      raffleDate: raffle.raffleDate.toISOString(),
      drawDate: raffle.drawDate.toISOString(),
      lotteryNumber: raffle.lotteryNumber,
      winningDigits: raffle.winningDigits,
      totalCollected: raffle.totalCollected,
      prizeAmount: raffle.prizeAmount,
      remainingAmount: raffle.remainingAmount,
      winnerId: raffle.winnerId,
      winnerName: raffle.winnerName,
      winnerRaffleNumber: raffle.winnerRaffleNumber,
      status: raffle.status,
      createdAt: raffle.createdAt.toISOString(),
      updatedAt: raffle.updatedAt.toISOString(),
    };
  }
}
