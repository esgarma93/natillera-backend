import { IsNotEmpty, IsNumber, IsOptional, IsString, IsDateString, Min, Max } from 'class-validator';

export class CreatePaymentDto {
  @IsNotEmpty()
  @IsString()
  partnerId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsNotEmpty()
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  voucherImageUrl?: string;

  @IsOptional()
  @IsString()
  whatsappMessageId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
