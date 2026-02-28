import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Payment, PaymentStatus } from '../domain/payment.entity';
import { PaymentRepository } from '../domain/payment.repository';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { IPartnerRepository, PARTNER_REPOSITORY } from '../../partners/domain/partner.repository';
import { PeriodsService } from '../../periods/application/periods.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class PaymentsService {
  private static readonly MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  constructor(
    @Inject('PaymentRepository')
    private readonly paymentRepository: PaymentRepository,
    @Inject(PARTNER_REPOSITORY)
    private readonly partnerRepository: IPartnerRepository,
    private readonly periodsService: PeriodsService,
    private readonly storageService: StorageService,
  ) {}

  async findAll(): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findAll();
    return Promise.all(payments.map((payment) => this.toResponseDto(payment)));
  }

  async findById(id: string): Promise<PaymentResponseDto> {
    const payment = await this.paymentRepository.findById(id);
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    return this.toResponseDto(payment);
  }

  async findByPartnerId(partnerId: string): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findByPartnerId(partnerId);
    return Promise.all(payments.map((payment) => this.toResponseDto(payment)));
  }

  async findByPeriodId(periodId: string): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findByPeriodId(periodId);
    return Promise.all(payments.map((payment) => this.toResponseDto(payment)));
  }

  async findByPeriodAndMonth(periodId: string, month: number): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findByPeriodAndMonth(periodId, month);
    return Promise.all(payments.map((payment) => this.toResponseDto(payment)));
  }

  async findByMonthAndYear(month: number, year: number): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findByMonthAndYear(month, year);
    return Promise.all(payments.map((payment) => this.toResponseDto(payment)));
  }

  async findByPartnerAndPeriod(partnerId: string, periodId: string): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findByPartnerAndPeriod(partnerId, periodId);
    return Promise.all(payments.map((payment) => this.toResponseDto(payment)));
  }

  async findByDateRange(startDate: string, endDate: string): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findByDateRange(
      new Date(startDate),
      new Date(endDate),
    );
    return Promise.all(payments.map((payment) => this.toResponseDto(payment)));
  }

  async create(createPaymentDto: CreatePaymentDto): Promise<PaymentResponseDto> {
    // Get active period
    const activePeriod = await this.periodsService.getActivePeriod();

    // Get partner to validate and get expected amount
    const partner = await this.partnerRepository.findById(createPaymentDto.partnerId);
    if (!partner) {
      throw new BadRequestException(`Partner with ID ${createPaymentDto.partnerId} not found`);
    }

    // Use partner's montoCuota or period's monthly fee as fallback
    const expectedAmount = partner.montoCuota || activePeriod.monthlyFee;
    const amount = createPaymentDto.amount;
    const difference = amount - expectedAmount;
    const month = createPaymentDto.month || new Date().getMonth() + 1;

    // Check if payment already exists for this partner/period/month
    const existingPayment = await this.paymentRepository.findByPartnerPeriodAndMonth(
      createPaymentDto.partnerId,
      activePeriod.id!,
      month,
    );
    if (existingPayment) {
      throw new BadRequestException(
        `Payment for partner ${partner.nombre} already exists for ${PaymentsService.MONTH_NAMES[month - 1]} ${activePeriod.year}`,
      );
    }

    const payment = new Payment({
      partnerId: createPaymentDto.partnerId,
      partnerName: partner.nombre,
      periodId: activePeriod.id!,
      periodYear: activePeriod.year,
      month,
      paymentDate: createPaymentDto.paymentDate ? new Date(createPaymentDto.paymentDate) : new Date(),
      amount,
      expectedAmount,
      difference,
      status: PaymentStatus.PENDING,
      voucherImageUrl: createPaymentDto.voucherImageUrl,
      whatsappMessageId: createPaymentDto.whatsappMessageId,
      notes: createPaymentDto.notes,
    });

    const created = await this.paymentRepository.create(payment);
    return this.toResponseDto(created);
  }

  async createFromWhatsApp(
    partnerId: string,
    amount: number,
    voucherImageUrl: string,
    whatsappMessageId: string,
  ): Promise<PaymentResponseDto> {
    // Get active period
    const activePeriod = await this.periodsService.getActivePeriod();

    const partner = await this.partnerRepository.findById(partnerId);
    if (!partner) {
      throw new BadRequestException(`Partner with ID ${partnerId} not found`);
    }

    const expectedAmount = partner.montoCuota || activePeriod.monthlyFee;
    const difference = amount - expectedAmount;
    const month = new Date().getMonth() + 1;

    // Check if payment already exists for this partner/period/month
    const existingPayment = await this.paymentRepository.findByPartnerPeriodAndMonth(
      partnerId,
      activePeriod.id!,
      month,
    );
    if (existingPayment) {
      throw new BadRequestException(
        `Payment for partner ${partner.nombre} already exists for ${PaymentsService.MONTH_NAMES[month - 1]} ${activePeriod.year}`,
      );
    }

    const payment = new Payment({
      partnerId,
      partnerName: partner.nombre,
      periodId: activePeriod.id!,
      periodYear: activePeriod.year,
      month,
      paymentDate: new Date(),
      amount,
      expectedAmount,
      difference,
      status: PaymentStatus.PENDING,
      voucherImageUrl,
      whatsappMessageId,
      notes: 'Payment received via WhatsApp',
    });

    const created = await this.paymentRepository.create(payment);
    return this.toResponseDto(created);
  }

  /**
   * Create payment from WhatsApp with voucher validation
   * Sets status to PENDING if validation issues found, VERIFIED if all validations pass
   */
  async createFromWhatsAppWithValidation(
    partnerId: string,
    amount: number,
    voucherImageUrl: string,
    whatsappMessageId: string,
    voucherType: string,
    voucherDate: Date | null,
    validationIssues: string[],
    voucherStorageKey?: string,
    whatsappFrom?: string,
  ): Promise<PaymentResponseDto> {
    // Get active period
    const activePeriod = await this.periodsService.getActivePeriod();

    const partner = await this.partnerRepository.findById(partnerId);
    if (!partner) {
      throw new BadRequestException(`Partner with ID ${partnerId} not found`);
    }

    const expectedAmount = partner.montoCuota || activePeriod.monthlyFee;
    const difference = amount - expectedAmount;
    
    // Determine month from voucher date or current date
    const paymentDate = voucherDate || new Date();
    const month = paymentDate.getMonth() + 1;

    // Check if payment already exists for this partner/period/month
    const existingPayment = await this.paymentRepository.findByPartnerPeriodAndMonth(
      partnerId,
      activePeriod.id!,
      month,
    );
    if (existingPayment) {
      throw new BadRequestException(
        `Payment for partner ${partner.nombre} already exists for ${PaymentsService.MONTH_NAMES[month - 1]} ${activePeriod.year}`,
      );
    }

    // Determine status based on validation issues
    const status = validationIssues.length > 0 ? PaymentStatus.PENDING : PaymentStatus.VERIFIED;
    const pendingDescription = validationIssues.length > 0 ? validationIssues.join(' | ') : undefined;

    const payment = new Payment({
      partnerId,
      partnerName: partner.nombre,
      periodId: activePeriod.id!,
      periodYear: activePeriod.year,
      month,
      paymentDate,
      amount,
      expectedAmount,
      difference,
      status,
      pendingDescription,
      voucherType,
      voucherImageUrl,
      voucherStorageKey,
      whatsappMessageId,
      notes: (() => {
        let base = whatsappFrom
          ? `Recibido por WhatsApp - ${voucherType.toUpperCase()} | Enviado desde: ${whatsappFrom}`
          : whatsappMessageId
            ? `Recibido por WhatsApp - ${voucherType.toUpperCase()}`
            : `Cargado desde el portal - ${voucherType.toUpperCase()}`;
        if (validationIssues.length > 0) {
          base += ` | Motivo pendiente: ${validationIssues.join('; ')}`;
        }
        return base;
      })(),
    });

    const created = await this.paymentRepository.create(payment);
    return this.toResponseDto(created);
  }

  /**
   * Find an existing payment for a partner in a given month/year.
   * Returns null if none exists.
   */
  async findExistingPayment(partnerId: string, month: number, year: number): Promise<PaymentResponseDto | null> {
    const activePeriod = await this.periodsService.getActivePeriod();
    const existing = await this.paymentRepository.findByPartnerPeriodAndMonth(
      partnerId,
      activePeriod.id!,
      month,
    );
    return existing ? this.toResponseDto(existing) : null;
  }

  /**
   * Accumulate a partial payment: adds additionalAmount to an existing payment.
   * If the new total >= expectedAmount, marks the payment PENDING for admin verification.
   */
  async accumulatePartialPayment(
    existingPaymentId: string,
    additionalAmount: number,
  ): Promise<PaymentResponseDto> {
    const existing = await this.paymentRepository.findById(existingPaymentId);
    if (!existing) {
      throw new NotFoundException(`Payment with ID ${existingPaymentId} not found`);
    }

    const newAmount = existing.amount + additionalAmount;
    const newDifference = newAmount - existing.expectedAmount;

    const complementNote = `Pago complementario: +$${additionalAmount.toLocaleString('es-CO')}`;
    const notes = existing.notes ? `${existing.notes} | ${complementNote}` : complementNote;

    const pendingDescription = newDifference >= 0
      ? 'Pago acumulado de múltiples comprobantes — verificar manualmente'
      : existing.pendingDescription;

    const updated = await this.paymentRepository.update(existingPaymentId, {
      amount: newAmount,
      difference: newDifference,
      status: PaymentStatus.PENDING,
      pendingDescription,
      notes,
    });

    return this.toResponseDto(updated);
  }

  async update(id: string, updatePaymentDto: UpdatePaymentDto): Promise<PaymentResponseDto> {
    const existing = await this.paymentRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    const updateData: Partial<Payment> = {};

    if (updatePaymentDto.partnerId && updatePaymentDto.partnerId !== existing.partnerId) {
      const partner = await this.partnerRepository.findById(updatePaymentDto.partnerId);
      if (!partner) {
        throw new BadRequestException(`Partner with ID ${updatePaymentDto.partnerId} not found`);
      }
      updateData.partnerId = updatePaymentDto.partnerId;
      updateData.partnerName = partner.nombre;
      updateData.expectedAmount = partner.montoCuota;
    }

    if (updatePaymentDto.paymentDate) {
      updateData.paymentDate = new Date(updatePaymentDto.paymentDate);
    }

    if (updatePaymentDto.month !== undefined) {
      updateData.month = updatePaymentDto.month;
    }

    if (updatePaymentDto.amount !== undefined) {
      updateData.amount = updatePaymentDto.amount;
    }

    if (updatePaymentDto.status) {
      updateData.status = updatePaymentDto.status;
    }

    if (updatePaymentDto.voucherImageUrl !== undefined) {
      updateData.voucherImageUrl = updatePaymentDto.voucherImageUrl;
    }

    if (updatePaymentDto.notes !== undefined) {
      updateData.notes = updatePaymentDto.notes;
    }

    // Recalculate difference if amount or expected amount changed
    const newAmount = updateData.amount ?? existing.amount;
    const newExpectedAmount = updateData.expectedAmount ?? existing.expectedAmount;
    updateData.difference = newAmount - newExpectedAmount;

    const updated = await this.paymentRepository.update(id, updateData);
    return this.toResponseDto(updated);
  }

  async updateStatus(id: string, status: PaymentStatus): Promise<PaymentResponseDto> {
    const existing = await this.paymentRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    const updated = await this.paymentRepository.update(id, { status });
    return this.toResponseDto(updated);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.paymentRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    // Delete voucher image from R2 if it exists
    if (existing.voucherStorageKey) {
      try {
        await this.storageService.deleteVoucher(existing.voucherStorageKey);
      } catch (err) {
        // Log but don't block deletion
      }
    }

    await this.paymentRepository.delete(id);
  }

  async getStatsByYear(year: number): Promise<{
    year: number;
    totalCollected: number;
    totalVerified: number;
    totalPending: number;
    totalRejected: number;
    monthlyBreakdown: Array<{
      month: number;
      monthName: string;
      totalCollected: number;
      verified: number;
      pending: number;
      rejected: number;
    }>;
  }> {
    // Get all payments for the year
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);
    const payments = await this.paymentRepository.findByDateRange(startDate, endDate);

    // Calculate totals by status
    const totalVerified = payments
      .filter(p => p.status === PaymentStatus.VERIFIED)
      .reduce((sum, p) => sum + p.amount, 0);
    
    const totalPending = payments
      .filter(p => p.status === PaymentStatus.PENDING)
      .reduce((sum, p) => sum + p.amount, 0);
    
    const totalRejected = payments
      .filter(p => p.status === PaymentStatus.REJECTED)
      .reduce((sum, p) => sum + p.amount, 0);

    // Total collected includes verified and pending (rejected are excluded from collection)
    const totalCollected = totalVerified + totalPending;

    // Monthly breakdown
    const monthlyBreakdown = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const monthPayments = payments.filter(p => p.month === month);
      
      return {
        month,
        monthName: PaymentsService.MONTH_NAMES[i],
        totalCollected: monthPayments
          .filter(p => p.status !== PaymentStatus.REJECTED)
          .reduce((sum, p) => sum + p.amount, 0),
        verified: monthPayments
          .filter(p => p.status === PaymentStatus.VERIFIED)
          .reduce((sum, p) => sum + p.amount, 0),
        pending: monthPayments
          .filter(p => p.status === PaymentStatus.PENDING)
          .reduce((sum, p) => sum + p.amount, 0),
        rejected: monthPayments
          .filter(p => p.status === PaymentStatus.REJECTED)
          .reduce((sum, p) => sum + p.amount, 0),
      };
    });

    return {
      year,
      totalCollected,
      totalVerified,
      totalPending,
      totalRejected,
      monthlyBreakdown,
    };
  }

  private async toResponseDto(payment: Payment): Promise<PaymentResponseDto> {
    // Resolve presigned URL for voucher (cached in Redis)
    const resolvedVoucherUrl = await this.storageService.getCachedPresignedUrl(
      payment.id,
      payment.voucherStorageKey,
      payment.voucherImageUrl,
    );

    return {
      id: payment.id,
      partnerId: payment.partnerId,
      partnerName: payment.partnerName,
      periodId: payment.periodId,
      periodYear: payment.periodYear,
      month: payment.month,
      monthName: PaymentsService.MONTH_NAMES[payment.month - 1],
      paymentDate: payment.paymentDate,
      amount: payment.amount,
      expectedAmount: payment.expectedAmount,
      difference: payment.difference,
      status: payment.status,
      pendingDescription: payment.pendingDescription,
      voucherType: payment.voucherType,
      voucherImageUrl: resolvedVoucherUrl ?? undefined,
      voucherStorageKey: payment.voucherStorageKey,
      whatsappMessageId: payment.whatsappMessageId,
      notes: payment.notes,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
