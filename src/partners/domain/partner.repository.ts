import { Partner } from './partner.entity';

export interface IPartnerRepository {
  findAll(): Promise<Partner[]>;
  findById(id: string): Promise<Partner | null>;
  findByNumeroRifa(numeroRifa: number): Promise<Partner | null>;
  create(partner: Partner): Promise<Partner>;
  update(id: string, partner: Partial<Partner>): Promise<Partner | null>;
  delete(id: string): Promise<boolean>;
}

export const PARTNER_REPOSITORY = 'PARTNER_REPOSITORY';
