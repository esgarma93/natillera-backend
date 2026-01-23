import { PeriodStatus } from '../../domain/period.entity';

export class PeriodResponseDto {
  id: string;
  year: number;
  name: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  monthlyFee: number;
  status: PeriodStatus;
  totalMonths: number;
  createdAt: Date;
  updatedAt: Date;
}

export class PeriodSummaryDto extends PeriodResponseDto {
  totalPartners: number;
  totalExpectedPayments: number;
  totalReceivedPayments: number;
  totalPendingPayments: number;
  collectionPercentage: number;
}
