import { IsNumber, IsString, IsOptional, IsEnum, IsDate, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { PeriodStatus } from '../../domain/period.entity';

export class UpdatePeriodDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  startDate?: Date;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  endDate?: Date;

  @IsNumber()
  @Min(0)
  @IsOptional()
  monthlyFee?: number;

  @IsEnum(PeriodStatus)
  @IsOptional()
  status?: PeriodStatus;

  @IsNumber()
  @Min(1)
  @Max(12)
  @IsOptional()
  totalMonths?: number;
}
