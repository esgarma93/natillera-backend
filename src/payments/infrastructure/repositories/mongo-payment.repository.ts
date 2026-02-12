import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment } from '../../domain/payment.entity';
import { PaymentRepository } from '../../domain/payment.repository';
import { PaymentSchema, PaymentDocument } from '../schemas/payment.schema';

@Injectable()
export class MongoPaymentRepository implements PaymentRepository {
  constructor(
    @InjectModel(PaymentSchema.name)
    private readonly paymentModel: Model<PaymentDocument>,
  ) {}

  async findAll(): Promise<Payment[]> {
    const payments = await this.paymentModel.find().sort({ periodYear: -1, month: -1, paymentDate: -1 }).exec();
    return payments.map((doc) => this.toEntity(doc));
  }

  async findById(id: string): Promise<Payment | null> {
    const payment = await this.paymentModel.findById(id).exec();
    return payment ? this.toEntity(payment) : null;
  }

  async findByPartnerId(partnerId: string): Promise<Payment[]> {
    const payments = await this.paymentModel
      .find({ partnerId })
      .sort({ periodYear: -1, month: -1 })
      .exec();
    return payments.map((doc) => this.toEntity(doc));
  }

  async findByPeriodId(periodId: string): Promise<Payment[]> {
    const payments = await this.paymentModel
      .find({ periodId })
      .sort({ month: 1, partnerName: 1 })
      .exec();
    return payments.map((doc) => this.toEntity(doc));
  }

  async findByPeriodAndMonth(periodId: string, month: number): Promise<Payment[]> {
    const payments = await this.paymentModel
      .find({ periodId, month })
      .sort({ partnerName: 1 })
      .exec();
    return payments.map((doc) => this.toEntity(doc));
  }

  async findByMonthAndYear(month: number, year: number): Promise<Payment[]> {
    const payments = await this.paymentModel
      .find({ month, periodYear: year })
      .sort({ partnerName: 1 })
      .exec();
    return payments.map((doc) => this.toEntity(doc));
  }

  async findByPartnerAndPeriod(partnerId: string, periodId: string): Promise<Payment[]> {
    const payments = await this.paymentModel
      .find({ partnerId, periodId })
      .sort({ month: 1 })
      .exec();
    return payments.map((doc) => this.toEntity(doc));
  }

  async findByPartnerPeriodAndMonth(partnerId: string, periodId: string, month: number): Promise<Payment | null> {
    const payment = await this.paymentModel
      .findOne({ partnerId, periodId, month })
      .exec();
    return payment ? this.toEntity(payment) : null;
  }

  async findByDateRange(startDate: Date, endDate: Date): Promise<Payment[]> {
    const payments = await this.paymentModel
      .find({
        paymentDate: { $gte: startDate, $lte: endDate },
      })
      .sort({ paymentDate: -1 })
      .exec();
    return payments.map((doc) => this.toEntity(doc));
  }

  async create(payment: Partial<Payment>): Promise<Payment> {
    const created = new this.paymentModel(payment);
    const saved = await created.save();
    return this.toEntity(saved);
  }

  async update(id: string, payment: Partial<Payment>): Promise<Payment | null> {
    const updated = await this.paymentModel
      .findByIdAndUpdate(id, { ...payment, updatedAt: new Date() }, { new: true })
      .exec();
    return updated ? this.toEntity(updated) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.paymentModel.findByIdAndDelete(id).exec();
    return !!result;
  }

  private toEntity(doc: PaymentDocument): Payment {
    return new Payment({
      id: doc._id.toString(),
      partnerId: doc.partnerId,
      partnerName: doc.partnerName,
      periodId: doc.periodId,
      periodYear: doc.periodYear,
      month: doc.month,
      paymentDate: doc.paymentDate,
      amount: doc.amount,
      expectedAmount: doc.expectedAmount,
      difference: doc.difference,
      status: doc.status,
      pendingDescription: doc.pendingDescription,
      voucherType: doc.voucherType,
      voucherImageUrl: doc.voucherImageUrl,
      whatsappMessageId: doc.whatsappMessageId,
      notes: doc.notes,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  }
}
