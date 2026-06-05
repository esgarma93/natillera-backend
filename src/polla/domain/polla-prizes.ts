/**
 * Polla economics.
 *
 * Each participating partner pays an entry fee. The natillera keeps a share and
 * the rest is split between the top two of the final ranking.
 *
 * Example: 30.000 × 32 socios = 960.000 → 480.000 natillera, 300.000 1.º, 180.000 2.º
 */

/** Entry fee per partner (COP). */
export const POLLA_ENTRY_FEE = 30000;

/** Share of the total pot the natillera keeps. */
export const POLLA_NATILLERA_SHARE = 0.5;

/** Share of the total pot distributed among winners (1st + 2nd). */
export const POLLA_PRIZE_SHARE = 0.5;

/** How the prize pool is split between the top two positions. */
export const POLLA_FIRST_PLACE_SHARE = 0.625; // 300.000 / 480.000
export const POLLA_SECOND_PLACE_SHARE = 0.375; // 180.000 / 480.000

export interface PollaPrizeBreakdown {
  participants: number;
  entryFee: number;
  totalPot: number;
  natilleraCut: number;
  prizePool: number;
  firstPlacePrize: number;
  secondPlacePrize: number;
}

/** Compute the prize breakdown for a given number of participants. */
export function computePollaPrizes(participants: number): PollaPrizeBreakdown {
  const totalPot = participants * POLLA_ENTRY_FEE;
  const natilleraCut = Math.round(totalPot * POLLA_NATILLERA_SHARE);
  const prizePool = totalPot - natilleraCut;
  const firstPlacePrize = Math.round(prizePool * POLLA_FIRST_PLACE_SHARE);
  const secondPlacePrize = prizePool - firstPlacePrize;
  return {
    participants,
    entryFee: POLLA_ENTRY_FEE,
    totalPot,
    natilleraCut,
    prizePool,
    firstPlacePrize,
    secondPlacePrize,
  };
}
