import { IsString, IsNumber, IsOptional, IsDate, IsArray, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateIntegrationDto {
  @IsString()
  name: string;

  @IsDate()
  @Type(() => Date)
  date: Date;

  @IsString()
  hostPartnerId: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  foodCostPerPerson?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
