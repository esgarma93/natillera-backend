import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';

export class SetMatchResultDto {
  @IsInt()
  @Min(0)
  @Max(30)
  homeScore: number;

  @IsInt()
  @Min(0)
  @Max(30)
  awayScore: number;

  /** Team that won on penalties (only when homeScore === awayScore). */
  @IsOptional()
  @IsString()
  penaltyWinner?: string;
}
