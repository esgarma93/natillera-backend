import { IsString, IsOptional } from 'class-validator';

export class UpdateMatchTeamsDto {
  @IsOptional()
  @IsString()
  homeTeam?: string;

  @IsOptional()
  @IsString()
  awayTeam?: string;
}
