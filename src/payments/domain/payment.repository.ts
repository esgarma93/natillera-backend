import { Payment } from './payment.entity';

export interface PaymentRepository {
  findAll(): Promise<Payment[]>;
  findById(id: string): Promise<Payment | null>;
  findByPartnerId(partnerId: string): Promise<Payment[]>;
  findByDateRange(startDate: Date, endDate: Date): Promise<Payment[]>;
  create(payment: Partial<Payment>): Promise<Payment>;
  update(id: string, payment: Partial<Payment>): Promise<Payment | null>;
  delete(id: string): Promise<boolean>;
}
