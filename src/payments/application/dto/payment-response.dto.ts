import { PaymentStatus } from '../../domain/payment.entity';

export class PaymentResponseDto {
  id: string;
  partnerId: string;
  partnerName: string;
  paymentDate: Date;
  amount: number;
  expectedAmount: number;
  difference: number;
  status: PaymentStatus;
  voucherImageUrl?: string;
  whatsappMessageId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
