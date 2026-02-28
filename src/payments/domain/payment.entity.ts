export enum PaymentStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

export interface IPayment {
  id?: string;
  partnerId: string;
  partnerName?: string;
  periodId: string;
  periodYear?: number;
  month: number; // 1-12
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

export class Payment implements IPayment {
  id?: string;
  partnerId: string;
  partnerName?: string;
  periodId: string;
  periodYear?: number;
  month: number;
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

  constructor(partial: Partial<IPayment>) {
    this.id = partial.id;
    this.partnerId = partial.partnerId || '';
    this.partnerName = partial.partnerName;
    this.periodId = partial.periodId || '';
    this.periodYear = partial.periodYear;
    this.month = partial.month || new Date().getMonth() + 1;
    this.paymentDate = partial.paymentDate || new Date();
    this.amount = partial.amount || 0;
    this.expectedAmount = partial.expectedAmount || 0;
    this.difference = partial.difference ?? (this.amount - this.expectedAmount);
    this.status = partial.status || PaymentStatus.PENDING;
    this.pendingDescription = partial.pendingDescription;
    this.voucherType = partial.voucherType;
    this.voucherImageUrl = partial.voucherImageUrl;
    this.voucherStorageKey = partial.voucherStorageKey;
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

  /**
   * Get month name in Spanish
   */
  getMonthName(): string {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return months[this.month - 1] || 'Desconocido';
  }
}
