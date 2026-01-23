import { Period } from './period.entity';

export const PERIOD_REPOSITORY = 'PeriodRepository';

export interface IPeriodRepository {
  findAll(): Promise<Period[]>;
  findById(id: string): Promise<Period | null>;
  findByYear(year: number): Promise<Period | null>;
  findActive(): Promise<Period | null>;
  create(period: Period): Promise<Period>;
  update(id: string, period: Partial<Period>): Promise<Period | null>;
  delete(id: string): Promise<boolean>;
}
