export enum IntegrationStatus {
  UPCOMING = 'upcoming',
  ACTIVE = 'active',
  SETTLED = 'settled',
  CANCELLED = 'cancelled',
}

/** What a guest pays for. Partners (non-guests) always pay 'full'. */
export enum GuestPaymentMode {
  /** Pays food + activity + profitability (= totalCostPerPerson). Default. */
  FULL = 'full',
  /** Pays only the activity/game pot (= activityCostPerPerson). */
  ACTIVITY_ONLY = 'activity_only',
  /** Pays only the food/lunch (= foodCostPerPerson). */
  FOOD_ONLY = 'food_only',
  /** Pays food + activity, no profitability (= foodCostPerPerson + activityCostPerPerson). */
  FOOD_AND_ACTIVITY = 'food_and_activity',
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
  /** What this attendee pays for. Only meaningful for guests; partners always pay 'full'. */
  paymentMode?: GuestPaymentMode;
  /** @deprecated Use paymentMode instead. Kept for backward compatibility — when true and paymentMode is unset, treated as ACTIVITY_ONLY. */
  activityOnly?: boolean;
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
    const activityAttendees = this.attendees.filter(a => Integration.attendeePaysActivity(a)).length;
    return this.activityCostPerPerson * (activityAttendees + this.absentPartnerIds.length);
  }

  computeActivityPrize(): number {
    return Math.round(this.computeActivityPot() / 2);
  }

  /** Resolve effective payment mode for an attendee (handles legacy activityOnly flag). */
  static getAttendeeMode(att: IIntegrationAttendee): GuestPaymentMode {
    if (!att.isGuest) return GuestPaymentMode.FULL;
    if (att.paymentMode) return att.paymentMode;
    if (att.activityOnly) return GuestPaymentMode.ACTIVITY_ONLY;
    return GuestPaymentMode.FULL;
  }

  static attendeePaysFood(att: IIntegrationAttendee): boolean {
    const mode = Integration.getAttendeeMode(att);
    return mode === GuestPaymentMode.FULL || mode === GuestPaymentMode.FOOD_ONLY || mode === GuestPaymentMode.FOOD_AND_ACTIVITY;
  }

  static attendeePaysActivity(att: IIntegrationAttendee): boolean {
    const mode = Integration.getAttendeeMode(att);
    return mode === GuestPaymentMode.FULL || mode === GuestPaymentMode.ACTIVITY_ONLY || mode === GuestPaymentMode.FOOD_AND_ACTIVITY;
  }

  static attendeePaysProfitability(att: IIntegrationAttendee): boolean {
    return Integration.getAttendeeMode(att) === GuestPaymentMode.FULL;
  }

  /** Expected amount this attendee owes given the integration's per-person costs. */
  getAttendeeExpectedAmount(att: IIntegrationAttendee): number {
    let total = 0;
    if (Integration.attendeePaysFood(att)) total += this.foodCostPerPerson;
    if (Integration.attendeePaysActivity(att)) total += this.activityCostPerPerson;
    if (Integration.attendeePaysProfitability(att)) total += this.profitabilityPerPerson;
    return total;
  }

  recalculate(): void {
    this.totalCostPerPerson = this.computeTotalCost();
    this.absentPenalty = this.computeAbsentPenalty();
    this.activityPot = this.computeActivityPot();
    this.activityPrize = this.computeActivityPrize();
  }

  /** Total collected from all attendees + absent partners.
   *  Note: absent partners contribute (activity + profitability) only \u2014 the half-food
   *  portion of absentPenalty is informational and not summed into the natillera total. */
  getTotalCollected(): number {
    const attendeeTotal = this.attendees.reduce((sum, a) => sum + this.getAttendeeExpectedAmount(a), 0);
    return attendeeTotal + (this.absentPartnerIds.length * (this.activityCostPerPerson + this.profitabilityPerPerson));
  }

  /** Amount paid to host for food */
  getFoodPayout(): number {
    const foodPayers = this.attendees.filter(a => Integration.attendeePaysFood(a)).length;
    return this.foodCostPerPerson * foodPayers;
  }

  /** Total profitability for the natillera */
  getProfitability(): number {
    const profitabilityPayers = this.attendees.filter(a => Integration.attendeePaysProfitability(a)).length;
    return this.activityPrize + ((profitabilityPayers + this.absentPartnerIds.length) * this.profitabilityPerPerson);
  }
}
