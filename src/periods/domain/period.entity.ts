export enum PeriodStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
  UPCOMING = 'upcoming',
}

export interface IPeriod {
  id?: string;
  year: number;
  name: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  monthlyFee: number;
  /** Fixed per-person profitability fee for integrations (e.g. 6000) */
  profitabilityPerPerson: number;
  /** Fixed per-person activity/game fee for integrations (e.g. 6000) */
  activityCostPerPerson: number;
  /** Monthly raffle fee per partner (e.g. 7000) */
  raffleFee: number;
  status: PeriodStatus;
  totalMonths: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Period implements IPeriod {
  id?: string;
  year: number;
  name: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  monthlyFee: number;
  profitabilityPerPerson: number;
  activityCostPerPerson: number;
  raffleFee: number;
  status: PeriodStatus;
  totalMonths: number;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<IPeriod>) {
    this.id = partial.id;
    this.year = partial.year || new Date().getFullYear();
    this.name = partial.name || `Natillera ${this.year}`;
    this.description = partial.description;
    this.startDate = partial.startDate || new Date(this.year, 0, 1);
    this.endDate = partial.endDate || new Date(this.year, 11, 31);
    this.monthlyFee = partial.monthlyFee || 0;
    this.profitabilityPerPerson = partial.profitabilityPerPerson ?? 6000;
    this.activityCostPerPerson = partial.activityCostPerPerson ?? 6000;
    this.raffleFee = partial.raffleFee ?? 7000;
    this.status = partial.status || PeriodStatus.UPCOMING;
    this.totalMonths = partial.totalMonths || 12;
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }

  static create(data: Partial<IPeriod>): Period {
    return new Period({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Check if a date falls within this period
   */
  isDateInPeriod(date: Date): boolean {
    return date >= this.startDate && date <= this.endDate;
  }

  /**
   * Get the month number (1-12) for a date within this period
   */
  getMonthForDate(date: Date): number | null {
    if (!this.isDateInPeriod(date)) {
      return null;
    }
    return date.getMonth() + 1; // 1-12
  }

  /**
   * Check if period is currently active
   */
  isActive(): boolean {
    return this.status === PeriodStatus.ACTIVE;
  }

  /**
   * Get month name in Spanish
   */
  static getMonthName(month: number): string {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return months[month - 1] || 'Desconocido';
  }
}
