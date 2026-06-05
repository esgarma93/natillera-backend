export interface IPollaGuest {
  id?: string;
  /** Display name of the guest participating in the polla. */
  nombre: string;
  /** Partner who invited this guest. */
  invitedByPartnerId: string;
  /** Cached name of the inviting partner (for display). */
  invitedByName?: string;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class PollaGuest implements IPollaGuest {
  id?: string;
  nombre: string;
  invitedByPartnerId: string;
  invitedByName?: string;
  activo: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<IPollaGuest>) {
    this.id = partial.id;
    this.nombre = partial.nombre || '';
    this.invitedByPartnerId = partial.invitedByPartnerId || '';
    this.invitedByName = partial.invitedByName;
    this.activo = partial.activo ?? true;
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }
}
