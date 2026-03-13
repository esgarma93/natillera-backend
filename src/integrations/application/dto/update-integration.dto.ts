import { IsString, IsNumber, IsOptional, IsDate, IsArray, IsEnum, Min, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { IntegrationStatus } from '../../domain/integration.entity';

export class AttendeeDto {
  @IsString()
  partnerId: string;

  @IsBoolean()
  @IsOptional()
  isGuest?: boolean;

  @IsString()
  @IsOptional()
  guestName?: string;

  @IsString()
  @IsOptional()
  invitedByPartnerId?: string;
}

export class UpdateIntegrationDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  date?: Date;

  @IsString()
  @IsOptional()
  hostPartnerId?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  foodCostPerPerson?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendeeDto)
  @IsOptional()
  attendees?: AttendeeDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  absentPartnerIds?: string[];

  @IsString()
  @IsOptional()
  activityWinnerId?: string;

  @IsEnum(IntegrationStatus)
  @IsOptional()
  status?: IntegrationStatus;

  @IsString()
  @IsOptional()
  notes?: string;
}
