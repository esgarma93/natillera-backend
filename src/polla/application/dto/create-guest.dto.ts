import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateGuestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  nombre: string;

  /** Partner who invites this guest to the polla. */
  @IsString()
  @IsNotEmpty()
  invitedByPartnerId: string;
}
