import { Integration } from './integration.entity';

export const INTEGRATION_REPOSITORY = 'IntegrationRepository';

export interface IIntegrationRepository {
  findAll(): Promise<Integration[]>;
  findById(id: string): Promise<Integration | null>;
  findByPeriodId(periodId: string): Promise<Integration[]>;
  findByYear(year: number): Promise<Integration[]>;
  findByStatus(status: string): Promise<Integration[]>;
  create(integration: Integration): Promise<Integration>;
  update(id: string, data: Partial<Integration>): Promise<Integration | null>;
  delete(id: string): Promise<boolean>;
}
