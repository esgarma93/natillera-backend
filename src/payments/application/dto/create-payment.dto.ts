import { IsNotEmpty, IsNumber, IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { PaymentStatus } from '../../domain/payment.entity';

export class CreatePaymentDto {
  @IsNotEmpty()
  @IsString()
  partnerId: string;

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
