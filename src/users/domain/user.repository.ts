import { User } from './user.entity';

export interface IUserRepository {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByCelular(celular: string): Promise<User | null>;
  findByPartnerId(partnerId: string): Promise<User | null>;
  create(user: User): Promise<User>;
  update(id: string, user: Partial<User>): Promise<User | null>;
  delete(id: string): Promise<boolean>;
}

export const USER_REPOSITORY = 'USER_REPOSITORY';
