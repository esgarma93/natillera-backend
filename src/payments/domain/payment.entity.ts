export enum PaymentStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

export interface IPayment {
  id?: string;
  partnerId: string;
  partnerName?: string;
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

export class Payment implements IPayment {
  id?: string;
  partnerId: string;
  partnerName?: string;
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

  constructor(partial: Partial<IPayment>) {
    this.id = partial.id;
    this.partnerId = partial.partnerId || '';
    this.partnerName = partial.partnerName;
    this.paymentDate = partial.paymentDate || new Date();
    this.amount = partial.amount || 0;
    this.expectedAmount = partial.expectedAmount || 0;
    this.difference = partial.difference ?? (this.amount - this.expectedAmount);
    this.status = partial.status || PaymentStatus.PENDING;
    this.voucherImageUrl = partial.voucherImageUrl;
    this.whatsappMessageId = partial.whatsappMessageId;
    this.notes = partial.notes;
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }

  isFullPayment(): boolean {
    return this.difference >= 0;
  }

  isPartialPayment(): boolean {
    return this.difference < 0;
  }
}
