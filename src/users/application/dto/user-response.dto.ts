import { UserRole } from '../../domain/user.entity';

export class UserResponseDto {
  id: string;
  celular: string;
  role: UserRole;
  partnerId: string;
  partnerName?: string;
  activo: boolean;
  fechaCreacion: Date;
  fechaActualizacion: Date;
}
