import { IsString, IsInt, Min, Max, IsOptional, IsBoolean } from 'class-validator';

export class CreatePredictionDto {
  /** Participant id: a partner id, or a guest id when isGuest is true. */
  @IsString()
  partnerId: string;

  /** True when the prediction is registered for an invited guest. */
  @IsOptional()
  @IsBoolean()
  isGuest?: boolean;

  @IsInt()
  @Min(0)
  @Max(30)
  homeScore: number;

  @IsInt()
  @Min(0)
  @Max(30)
  awayScore: number;
}
