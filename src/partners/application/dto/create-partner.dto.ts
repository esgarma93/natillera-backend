import { IsString, IsNumber, IsOptional, Min, IsNotEmpty } from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsNumber()
  @Min(0)
  montoCuota: number;

  @IsNumber()
  @Min(1)
  numeroRifa: number;

  @IsOptional()
  @IsString()
  idPartnerPatrocinador?: string;
}
