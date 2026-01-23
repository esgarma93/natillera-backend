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
