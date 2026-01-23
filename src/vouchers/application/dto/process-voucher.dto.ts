import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class ProcessVoucherDto {
  @IsNotEmpty()
  @IsString()
  partnerId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  month?: number;

  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
