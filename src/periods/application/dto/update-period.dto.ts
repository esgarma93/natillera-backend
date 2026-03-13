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

  @IsNumber()
  @Min(0)
  @IsOptional()
  profitabilityPerPerson?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  activityCostPerPerson?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  raffleFee?: number;

  @IsEnum(PeriodStatus)
  @IsOptional()
  status?: PeriodStatus;

  @IsNumber()
  @Min(1)
  @Max(12)
  @IsOptional()
  totalMonths?: number;
}
