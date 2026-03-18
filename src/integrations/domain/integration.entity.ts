export enum IntegrationStatus {
  UPCOMING = 'upcoming',
  ACTIVE = 'active',
  SETTLED = 'settled',
  CANCELLED = 'cancelled',
}

export interface IIntegrationAttendee {
  partnerId: string;
  partnerName: string;
  isGuest: boolean;
  /** Name of the guest (only when isGuest = true) */
  guestName?: string;
  /** Partner who invited this guest (only when isGuest = true) */
  invitedByPartnerId?: string;
  invitedByPartnerName?: string;
  paid: boolean;
  paymentId?: string;
}

export interface IIntegration {
  id?: string;
  periodId: string;
  periodYear: number;
  name: string;
  date: Date;
  /** Host partner who provides the venue */
  hostPartnerId: string;
  hostPartnerName: string;
  /** Per-person food/drink cost set by the host */
  foodCostPerPerson: number;
  /** Per-person profitability fee (from period config, e.g. 6000) */
  profitabilityPerPerson: number;
  /** Per-person activity/game fee (from period config, e.g. 6000) */
  activityCostPerPerson: number;
  /** Computed: foodCostPerPerson + profitabilityPerPerson + activityCostPerPerson */
  totalCostPerPerson: number;
  /** Computed: Math.round(foodCostPerPerson / 2) + profitabilityPerPerson + activityCostPerPerson — absent partners pay half food + full fees */
  absentPenalty: number;
  /** Winner of the activity/game gets half of the activity pot */
  activityWinnerId?: string;
  activityWinnerName?: string;
  /** Computed: activityCostPerPerson × attendees.length (total pot) */
  activityPot: number;
  /** Computed: Math.round(activityPot / 2) — winner gets half */
  activityPrize: number;
  /** Attendees list (partners + guests) */
  attendees: IIntegrationAttendee[];
  /** Absent active partners who owe the penalty */
  absentPartnerIds: string[];
  status: IntegrationStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class Integration implements IIntegration {
  id?: string;
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

  constructor(partial: Partial<IIntegration>) {
    this.id = partial.id;
    this.periodId = partial.periodId || '';
    this.periodYear = partial.periodYear || new Date().getFullYear();
    this.name = partial.name || '';
    this.date = partial.date || new Date();
    this.hostPartnerId = partial.hostPartnerId || '';
    this.hostPartnerName = partial.hostPartnerName || '';
    this.foodCostPerPerson = partial.foodCostPerPerson || 0;
    this.profitabilityPerPerson = partial.profitabilityPerPerson ?? 6000;
    this.activityCostPerPerson = partial.activityCostPerPerson ?? 6000;
    this.totalCostPerPerson = partial.totalCostPerPerson ?? this.computeTotalCost();
    this.absentPenalty = partial.absentPenalty ?? this.computeAbsentPenalty();
    this.activityWinnerId = partial.activityWinnerId;
    this.activityWinnerName = partial.activityWinnerName;
    this.attendees = partial.attendees || [];
    this.absentPartnerIds = partial.absentPartnerIds || [];
    this.activityPot = partial.activityPot ?? this.computeActivityPot();
    this.activityPrize = partial.activityPrize ?? this.computeActivityPrize();
    this.status = partial.status || IntegrationStatus.UPCOMING;
    this.notes = partial.notes;
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }

  computeTotalCost(): number {
    return this.foodCostPerPerson + this.profitabilityPerPerson + this.activityCostPerPerson;
  }

  computeAbsentPenalty(): number {
    return Math.round(this.foodCostPerPerson / 2) + this.profitabilityPerPerson + this.activityCostPerPerson;
  }

  computeActivityPot(): number {
    return this.activityCostPerPerson * this.attendees.length;
  }

  computeActivityPrize(): number {
    return Math.round(this.computeActivityPot() / 2);
  }

  recalculate(): void {
    this.totalCostPerPerson = this.computeTotalCost();
    this.absentPenalty = this.computeAbsentPenalty();
    this.activityPot = this.computeActivityPot();
    this.activityPrize = this.computeActivityPrize();
  }

  /** Total collected from all attendees + absent penalties */
  getTotalCollected(): number {
    return (this.attendees.length * this.totalCostPerPerson) +
      (this.absentPartnerIds.length * this.absentPenalty);
  }

  /** Amount paid to host for food */
  getFoodPayout(): number {
    return this.foodCostPerPerson * this.attendees.length;
  }

  /** Total profitability for the natillera */
  getProfitability(): number {
    const profitFromAttendees = this.profitabilityPerPerson * this.attendees.length;
    const profitFromAbsent = (Math.round(this.foodCostPerPerson / 2) + this.profitabilityPerPerson) * this.absentPartnerIds.length;
    const activityProfit = this.activityPot - this.activityPrize;
    return profitFromAttendees + profitFromAbsent + activityProfit;
  }
}
