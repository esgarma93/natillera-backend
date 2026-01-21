export class PartnerResponseDto {
  id: string;
  nombre: string;
  montoCuota: number;
  numeroRifa: number;
  idPartnerPatrocinador?: string;
  activo: boolean;
  fechaCreacion: Date;
  fechaActualizacion: Date;
}
