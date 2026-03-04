/**
 * Pure utility functions shared across WhatsApp handlers.
 * No dependencies on NestJS or external services.
 */

/**
 * Extract raffle number from text (e.g., "#5", "Rifa 5", "rifa5")
 */
export function extractRaffleNumber(text: string): number | null {
  const match = text.match(/#?(?:rifa\s*)?(\d+)/i);
  if (match) {
    const num = parseInt(match[1], 10);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Get month name in Spanish
 */
export function getMonthName(month: number): string {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return months[month - 1] || 'Desconocido';
}

/**
 * Determine the billing period for a payment based on the payment date.
 * The deadline to pay for month X is the 5th of month X+1.
 * - Day 1–5 of month X:  billing month = X-1 (previous month, still within deadline)
 * - Day 6–14 of month X: ambiguous — user must choose (X-1 late with penalty, or X early/on time)
 * - Day 15–31 of month X: billing month = X (current calendar month)
 */
export function determineBillingPeriod(date: Date): {
  month: number;
  year: number;
  status: 'on_time' | 'ambiguous';
  daysLate?: number;
  penalty?: number;
  lateMonth?: number;
  lateYear?: number;
  onTimeMonth?: number;
  onTimeYear?: number;
} {
  const day = date.getDate();
  const calendarMonth = date.getMonth() + 1;
  const calendarYear = date.getFullYear();

  // Previous month (for day 1-5 and ambiguous range)
  const prevMonth = calendarMonth === 1 ? 12 : calendarMonth - 1;
  const prevYear = calendarMonth === 1 ? calendarYear - 1 : calendarYear;

  if (day <= 5) {
    // Day 1-5: billing month = previous month (on time, within deadline)
    return { month: prevMonth, year: prevYear, status: 'on_time' };
  } else if (day >= 15) {
    // Day 15-31: billing month = current calendar month
    return { month: calendarMonth, year: calendarYear, status: 'on_time' };
  } else {
    // Day 6-14: ambiguous — previous month (late) or current month (on time)
    const daysLate = day - 5;
    const penalty = daysLate * 2000;
    return {
      month: calendarMonth,
      year: calendarYear,
      status: 'ambiguous',
      daysLate,
      penalty,
      lateMonth: prevMonth,
      lateYear: prevYear,
      onTimeMonth: calendarMonth,
      onTimeYear: calendarYear,
    };
  }
}

/**
 * Normalize a WhatsApp phone number for DB lookup.
 * WhatsApp sends numbers with country prefix (e.g. 573108214820).
 * The DB stores numbers without the country prefix.
 * Strips non-digits, then removes the country code based on known patterns:
 *   - Colombia (+57): 57 + 10 digits = 12 digits → slice(2)
 *   - USA/Canada (+1): 1 + 10 digits  = 11 digits → slice(1)
 */
export function normalizePhone(from: string): string {
  const digits = from.replace(/\D/g, '');
  // Colombian numbers: country code 57 + 10-digit number = 12 digits
  if (digits.length === 12 && digits.startsWith('57')) {
    return digits.slice(2);
  }
  // US/Canada numbers: country code 1 + 10-digit number = 11 digits
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Returns the last Friday of a given month
 */
export function getLastFridayOfMonth(month: number, year: number): Date {
  const lastDay = new Date(year, month, 0);
  for (let day = lastDay.getDate(); day >= lastDay.getDate() - 6; day--) {
    const date = new Date(year, month - 1, day);
    if (date.getDay() === 5) return date;
  }
  return lastDay;
}

/**
 * Build a short redirect URL for a payment voucher.
 * The backend /payments/:id/voucher endpoint redirects to the presigned URL.
 * This avoids WhatsApp truncating long presigned URLs.
 */
export function buildVoucherRedirectUrl(paymentId: string): string {
  const appUrl = (process.env.APP_URL || 'https://natillera-backend-production.up.railway.app').replace(/\/+$/, '');
  return `${appUrl}/payments/${paymentId}/voucher`;
}
