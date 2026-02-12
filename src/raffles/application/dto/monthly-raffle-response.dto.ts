import { RaffleStatus } from '../../domain/monthly-raffle.entity';

export class MonthlyRaffleResponseDto {
  id: string;
  month: number;
  monthName: string;
  year: number;
  raffleDate: string;
  drawDate: string;
  
  lotteryNumber?: string;
  winningDigits?: string;
  
  totalCollected: number;
  prizeAmount: number;
  remainingAmount: number;
  
  winnerId?: string;
  winnerName?: string;
  winnerRaffleNumber?: string;
  
  status: RaffleStatus;
  
  createdAt: string;
  updatedAt: string;
}
