import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Payment, PaymentStatus } from '../domain/payment.entity';
import { PaymentRepository } from '../domain/payment.repository';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';
import { IPartnerRepository, PARTNER_REPOSITORY } from '../../partners/domain/partner.repository';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject('PaymentRepository')
    private readonly paymentRepository: PaymentRepository,
    @Inject(PARTNER_REPOSITORY)
    private readonly partnerRepository: IPartnerRepository,
  ) {}

  async findAll(): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findAll();
    return payments.map((payment) => this.toResponseDto(payment));
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
    return payments.map((payment) => this.toResponseDto(payment));
  }

  async findByDateRange(startDate: string, endDate: string): Promise<PaymentResponseDto[]> {
    const payments = await this.paymentRepository.findByDateRange(
      new Date(startDate),
      new Date(endDate),
    );
    return payments.map((payment) => this.toResponseDto(payment));
  }

  async create(createPaymentDto: CreatePaymentDto): Promise<PaymentResponseDto> {
    // Get partner to validate and get expected amount
    const partner = await this.partnerRepository.findById(createPaymentDto.partnerId);
    if (!partner) {
      throw new BadRequestException(`Partner with ID ${createPaymentDto.partnerId} not found`);
    }

    const expectedAmount = partner.montoCuota;
    const amount = createPaymentDto.amount;
    const difference = amount - expectedAmount;

    const payment = new Payment({
      partnerId: createPaymentDto.partnerId,
      partnerName: partner.nombre,
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
    const partner = await this.partnerRepository.findById(partnerId);
    if (!partner) {
      throw new BadRequestException(`Partner with ID ${partnerId} not found`);
    }

    const expectedAmount = partner.montoCuota;
    const difference = amount - expectedAmount;

    const payment = new Payment({
      partnerId,
      partnerName: partner.nombre,
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

    await this.paymentRepository.delete(id);
  }

  private toResponseDto(payment: Payment): PaymentResponseDto {
    return {
      id: payment.id,
      partnerId: payment.partnerId,
      partnerName: payment.partnerName,
      paymentDate: payment.paymentDate,
      amount: payment.amount,
      expectedAmount: payment.expectedAmount,
      difference: payment.difference,
      status: payment.status,
      voucherImageUrl: payment.voucherImageUrl,
      whatsappMessageId: payment.whatsappMessageId,
      notes: payment.notes,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}
