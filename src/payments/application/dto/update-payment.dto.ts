import { IsNumber, IsOptional, IsString, IsDateString, IsEnum } from 'class-validator';
import { PaymentStatus } from '../../domain/payment.entity';

export class UpdatePaymentDto {
  @IsOptional()
  @IsString()
  partnerId?: string;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsString()
  voucherImageUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
