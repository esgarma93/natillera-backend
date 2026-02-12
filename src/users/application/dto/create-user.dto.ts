import { IsString, IsEnum, IsNotEmpty, Matches, Length } from 'class-validator';
import { UserRole } from '../../domain/user.entity';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{10,15}$/, { message: 'Cellphone must be 10-15 digits' })
  celular: string;

  @IsString()
  @Length(4, 4, { message: 'PIN must be exactly 4 digits' })
  @Matches(/^\d{4}$/, { message: 'PIN must be 4 numeric digits' })
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsString()
  @IsNotEmpty()
  partnerId: string;
}
