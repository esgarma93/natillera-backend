import { PaymentStatus, PaymentType } from '../../domain/payment.entity';

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
  type: PaymentType;
  integrationId?: string;
  createdAt: Date;
  updatedAt: Date;
}
