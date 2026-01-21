import { IsString, IsNumber, IsOptional, Min, IsBoolean } from 'class-validator';

export class UpdatePartnerDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  montoCuota?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  numeroRifa?: number;

  @IsOptional()
  @IsString()
  idPartnerPatrocinador?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
