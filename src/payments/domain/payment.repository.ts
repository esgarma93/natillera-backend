import { Payment } from './payment.entity';

export interface PaymentRepository {
  findAll(): Promise<Payment[]>;
  findById(id: string): Promise<Payment | null>;
  findByPartnerId(partnerId: string): Promise<Payment[]>;
  findByPeriodId(periodId: string): Promise<Payment[]>;
  findByPeriodAndMonth(periodId: string, month: number): Promise<Payment[]>;
  findByMonthAndYear(month: number, year: number): Promise<Payment[]>;
  findByPartnerAndPeriod(partnerId: string, periodId: string): Promise<Payment[]>;
  findByPartnerPeriodAndMonth(partnerId: string, periodId: string, month: number): Promise<Payment | null>;
  findByDateRange(startDate: Date, endDate: Date): Promise<Payment[]>;
  create(payment: Partial<Payment>): Promise<Payment>;
  update(id: string, payment: Partial<Payment>): Promise<Payment | null>;
  delete(id: string): Promise<boolean>;
}
