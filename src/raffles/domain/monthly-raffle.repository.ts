import { MonthlyRaffle } from './monthly-raffle.entity';

export interface MonthlyRaffleRepository {
  create(raffle: MonthlyRaffle): Promise<MonthlyRaffle>;
  findById(id: string): Promise<MonthlyRaffle | null>;
  findByMonthAndYear(month: number, year: number): Promise<MonthlyRaffle | null>;
  findAll(): Promise<MonthlyRaffle[]>;
  findByYear(year: number): Promise<MonthlyRaffle[]>;
  update(id: string, updates: Partial<MonthlyRaffle>): Promise<MonthlyRaffle | null>;
  delete(id: string): Promise<boolean>;
}
