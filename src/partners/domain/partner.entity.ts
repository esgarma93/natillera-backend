export interface IPartner {
  id?: string;
  nombre: string;
  celular?: string;
  montoCuota: number;
  numeroRifa: number;
  idPartnerPatrocinador?: string;
  activo: boolean;
  fechaCreacion: Date;
  fechaActualizacion: Date;
}

export class Partner implements IPartner {
  id?: string;
  nombre: string;
  celular?: string;
  montoCuota: number;
  numeroRifa: number;
  idPartnerPatrocinador?: string;
  activo: boolean;
  fechaCreacion: Date;
  fechaActualizacion: Date;

  constructor(partial: Partial<IPartner>) {
    this.id = partial.id;
    this.nombre = partial.nombre || '';
    this.celular = partial.celular;
    this.montoCuota = partial.montoCuota || 0;
    this.numeroRifa = partial.numeroRifa || 0;
    this.idPartnerPatrocinador = partial.idPartnerPatrocinador;
    this.activo = partial.activo ?? true;
    this.fechaCreacion = partial.fechaCreacion || new Date();
    this.fechaActualizacion = partial.fechaActualizacion || new Date();
  }

  static create(data: Partial<IPartner>): Partner {
    return new Partner({
      ...data,
      fechaCreacion: new Date(),
      fechaActualizacion: new Date(),
      activo: true,
    });
  }

  update(data: Partial<IPartner>): void {
    if (data.nombre !== undefined) this.nombre = data.nombre;
    if (data.celular !== undefined) this.celular = data.celular;
    if (data.montoCuota !== undefined) this.montoCuota = data.montoCuota;
    if (data.numeroRifa !== undefined) this.numeroRifa = data.numeroRifa;
    if (data.idPartnerPatrocinador !== undefined) this.idPartnerPatrocinador = data.idPartnerPatrocinador;
    if (data.activo !== undefined) this.activo = data.activo;
    this.fechaActualizacion = new Date();
  }
}
