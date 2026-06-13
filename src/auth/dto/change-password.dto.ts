import { IsString, IsNotEmpty, Matches, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @Length(4, 4, { message: 'El nuevo PIN debe tener exactamente 4 dígitos' })
  @Matches(/^\d{4}$/, { message: 'El nuevo PIN debe ser numérico' })
  newPassword: string;
}
