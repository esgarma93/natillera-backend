import { Injectable, Inject } from '@nestjs/common';
import { IPartnerRepository, PARTNER_REPOSITORY } from './partners/domain/partner.repository';
import { PaymentRepository } from './payments/domain/payment.repository';
import { PeriodsService } from './periods/application/periods.service';

@Injectable()
export class AppService {
  constructor(
    @Inject(PARTNER_REPOSITORY)
    private readonly partnerRepository: IPartnerRepository,
    @Inject('PaymentRepository')
    private readonly paymentRepository: PaymentRepository,
    private readonly periodsService: PeriodsService,
  ) {}

  getHello() {
    return { message: 'Natillera API is running' };
  }

  async getStats() {
    // Get all partners
    const partners = await this.partnerRepository.findAll();
    const totalPartners = partners.length;

    // Get active period
    let monthlyFee = 0;
    let nextRaffleDate = null;
    try {
      const activePeriod = await this.periodsService.getActivePeriod();
      monthlyFee = activePeriod.monthlyFee || 0;
      
      // Calculate next raffle date (assuming it's the last day of each month)
      const now = new Date();
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      nextRaffleDate = nextMonth.toISOString().split('T')[0];
    } catch (error) {
      // No active period
    }

    // Get current month payments
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    
    // Calculate total collected this month
    let totalCollected = 0;
    try {
      const activePeriod = await this.periodsService.getActivePeriod();
      const payments = await this.paymentRepository.findByPeriodAndMonth(
        activePeriod.id!,
        currentMonth,
      );
      totalCollected = payments.reduce((sum, payment) => sum + payment.amount, 0);
    } catch (error) {
      // No active period or payments
    }

    return {
      totalPartners,
      monthlyFee,
      totalCollected,
      nextRaffleDate,
    };
  }
}
