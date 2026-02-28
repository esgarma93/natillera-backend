import { PaymentStatus } from '../../domain/payment.entity';

export class PaymentResponseDto {
  id: string;
  partnerId: string;
  partnerName: string;
  periodId: string;
  periodYear?: number;
  month: number;
  monthName?: string;
  paymentDate: Date;
  amount: number;
  expectedAmount: number;
  difference: number;
  status: PaymentStatus;
  pendingDescription?: string;
  voucherType?: string;
  voucherImageUrl?: string;
  voucherStorageKey?: string;
  whatsappMessageId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
