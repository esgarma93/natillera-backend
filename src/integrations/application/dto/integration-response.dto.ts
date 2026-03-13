import { IntegrationStatus, IIntegrationAttendee } from '../../domain/integration.entity';

export class IntegrationResponseDto {
  id: string;
  periodId: string;
  periodYear: number;
  name: string;
  date: Date;
  hostPartnerId: string;
  hostPartnerName: string;
  foodCostPerPerson: number;
  profitabilityPerPerson: number;
  activityCostPerPerson: number;
  totalCostPerPerson: number;
  absentPenalty: number;
  activityWinnerId?: string;
  activityWinnerName?: string;
  activityPot: number;
  activityPrize: number;
  attendees: IIntegrationAttendee[];
  absentPartnerIds: string[];
  status: IntegrationStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  // Computed summary
  totalCollected: number;
  foodPayout: number;
  profitability: number;
}
