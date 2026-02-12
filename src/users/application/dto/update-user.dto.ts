import { IsString, IsEnum, IsOptional, IsBoolean, Matches, Length } from 'class-validator';
import { UserRole } from '../../domain/user.entity';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'Cellphone must be 10-15 digits' })
  celular?: string;

  @IsOptional()
  @IsString()
  @Length(4, 4, { message: 'PIN must be exactly 4 digits' })
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 numeric digits' })
  password?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
