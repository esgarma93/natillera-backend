export enum RaffleStatus {
  PENDING = 'pending',      // Esperando resultado
  COMPLETED = 'completed',  // Ya hay ganador o se determinó que no hubo
  NO_WINNER = 'no_winner',  // No hubo ganador ese mes
}

export class MonthlyRaffle {
  id?: string;
  month: number;           // 1-12
  year: number;
  raffleDate: Date;        // Último viernes del mes
  drawDate: Date;          // Fecha en que se obtuvo el resultado (sábado)
  
  // Resultado de la lotería
  lotteryNumber?: string;  // Número completo de la lotería
  winningDigits?: string;  // Últimos 2 dígitos
  
  // Recaudación
  totalCollected: number;  // Total recaudado de rifas ese mes
  prizeAmount: number;     // 50% del total recaudado
  remainingAmount: number; // 50% que queda en la natillera
  
  // Ganador
  winnerId?: string;       // ID del partner ganador (si existe)
  winnerName?: string;     // Nombre del ganador
  winnerRaffleNumber?: string; // Número de rifa del ganador
  
  status: RaffleStatus;
  
  // Auditoría
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<MonthlyRaffle>) {
    Object.assign(this, partial);
    
    if (!this.createdAt) {
      this.createdAt = new Date();
    }
    if (!this.updatedAt) {
      this.updatedAt = new Date();
    }
  }
}
