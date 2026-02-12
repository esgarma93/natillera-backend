import { IsNotEmpty, IsNumber, IsOptional, IsString, Min, Max, IsArray } from 'class-validator';

export class ProcessVoucherDto {
  @IsNotEmpty()
  @IsString()
  partnerId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsNumber()
  @Min(2020)
  @Max(2100)
  year?: number;

  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sponsoredPartnerIds?: string[]; // IDs of sponsored partners to apply excess payment
}
