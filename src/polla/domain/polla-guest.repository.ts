import { PollaGuest } from './polla-guest.entity';

export const POLLA_GUEST_REPOSITORY = 'PollaGuestRepository';

export interface IPollaGuestRepository {
  findAll(): Promise<PollaGuest[]>;
  findById(id: string): Promise<PollaGuest | null>;
  create(guest: PollaGuest): Promise<PollaGuest>;
  update(id: string, data: Partial<PollaGuest>): Promise<PollaGuest | null>;
  delete(id: string): Promise<boolean>;
}
