export class VoucherResultDto {
  success: boolean;
  payment?: {
    id: string;
    partnerId: string;
    partnerName: string;
    amount: number;
    expectedAmount: number;
    month: number;
    monthName: string;
    periodYear: number;
    status: string;
    paymentDate: string;
  };
  additionalPayments?: Array<{
    id: string;
    partnerId: string;
    partnerName: string;
    amount: number;
    expectedAmount: number;
    month: number;
    monthName: string;
    periodYear: number;
    status: string;
    paymentDate: string;
  }>;
  excessAmount?: number; // Remaining excess after all payments
  sponsoredPartners?: Array<{ // Available sponsored partners for excess payment
    id: string;
    nombre: string;
    numeroRifa: number;
    montoCuota: number;
  }>;
  needsSponsorSelection?: boolean; // True if user needs to select sponsored partners
  voucher: {
    type: string;
    amount: number | null;
    date: string | null;
    destinationAccount: string | null;
    referenceNumber: string | null;
    confidence: number;
    rawText: string;
  };
  validation: {
    isValid: boolean;
    issues: string[];
  };
  error?: string;
}
