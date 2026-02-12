export enum UserRole {
  ADMIN = 'admin',
  VIEWER = 'viewer',
}

export interface IUser {
  id?: string;
  celular: string; // Username (partner's phone number)
  password: string; // 4-digit PIN (hashed)
  role: UserRole;
  partnerId: string; // Reference to Partner
  activo: boolean;
  fechaCreacion: Date;
  fechaActualizacion: Date;
}

export class User implements IUser {
  id?: string;
  celular: string;
  password: string;
  role: UserRole;
  partnerId: string;
  activo: boolean;
  fechaCreacion: Date;
  fechaActualizacion: Date;

  constructor(partial: Partial<IUser>) {
    this.id = partial.id;
    this.celular = partial.celular || '';
    this.password = partial.password || '';
    this.role = partial.role || UserRole.VIEWER;
    this.partnerId = partial.partnerId || '';
    this.activo = partial.activo ?? true;
    this.fechaCreacion = partial.fechaCreacion || new Date();
    this.fechaActualizacion = partial.fechaActualizacion || new Date();
  }

  static create(data: Partial<IUser>): User {
    return new User({
      ...data,
      fechaCreacion: new Date(),
      fechaActualizacion: new Date(),
      activo: true,
    });
  }

  update(data: Partial<IUser>): void {
    if (data.celular !== undefined) this.celular = data.celular;
    if (data.password !== undefined) this.password = data.password;
    if (data.role !== undefined) this.role = data.role;
    if (data.partnerId !== undefined) this.partnerId = data.partnerId;
    if (data.activo !== undefined) this.activo = data.activo;
    this.fechaActualizacion = new Date();
  }
}
