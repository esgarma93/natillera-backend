import { UserRole } from '../../users/domain/user.entity';

export class LoginResponseDto {
  accessToken: string;
  user: {
    id: string;
    celular: string;
    role: UserRole;
    partnerId: string;
    partnerName?: string;
  };
}
