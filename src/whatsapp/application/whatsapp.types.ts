// ─────────────────── REDIS KEY PREFIXES ───────────────────
export const KEY_WA_AUTH = 'wa:auth:';
export const KEY_WA_PENDING = 'wa:pending:';
export const KEY_WA_SPONSOR = 'wa:sponsor:';
export const KEY_WA_MONTH_CHOICE = 'wa:month_choice:';
export const KEY_WA_VOUCHER_MONTH = 'wa:voucher_month:';
export const KEY_WA_ADMIN_PAY = 'wa:admin_pay:';

// ─────────────────── TTLs (seconds) ───────────────────
export const AUTH_SESSION_TTL = 60 * 60;       // 1 hour
export const PENDING_SESSION_TTL = 10 * 60;    // 10 minutes

// ─────────────────── CONSTANTS ───────────────────
export const MAX_PIN_ATTEMPTS = 3;

// ─────────────────── INTERFACES ───────────────────

/** Pending image session: stored while waiting for raffle number from user */
export interface PendingSession {
  imageId: string;
  imageUrl: string;
  messageId: string;
  detectedAmount: number | null;
  parsedVoucher: any;
  from: string;
  storageKey?: string;
}

/** Pending sponsor choice: stored while waiting for user to confirm sponsored partner */
export interface PendingSponsorChoice {
  imageId: string;
  imageUrl: string;
  messageId: string;
  detectedAmount: number;
  parsedVoucher: any;
  from: string;
  originalPartnerId: string;
  originalPartnerName: string;
  originalPartnerMontoCuota: number;
  storageKey?: string;
  /** true when the amount covers the main partner + excess for sponsored */
  isSplitPayment?: boolean;
  /** excess amount = detectedAmount - originalPartnerMontoCuota */
  excessAmount?: number;
  /** pre-resolved billing month (avoids re-triggering month choice) */
  overrideBillingMonth?: number;
  /** pre-resolved billing year */
  overrideBillingYear?: number;
  sponsoredOptions: Array<{
    id: string;
    nombre: string;
    numeroRifa: number;
    montoCuota: number;
  }>;
}

/** Pending month choice: stored when payment date falls on day 6-14 (ambiguous billing period) */
export interface PendingMonthChoice {
  partnerId: string;
  detectedAmount: number;
  parsedVoucher: any;
  imageUrl: string;
  imageId: string;
  messageId: string;
  storageKey?: string;
  skipSponsorCheck: boolean;
  lateMonth: number;      // previous month (option 1 — with penalty)
  lateYear: number;
  onTimeMonth: number;    // current month (option 2 — on time)
  onTimeYear: number;
  daysLate: number;
  penalty: number;
}

/** Authentication session per phone number */
export interface AuthSession {
  authenticated: boolean;
  attempts: number;       // failed PIN attempts
  waitingForPin: boolean; // true = bot asked for PIN, waiting response
  pendingCommand?: string; // command that triggered the PIN flow (e.g. 'menu')
  menuActive?: boolean;    // true = numbered menu was shown, waiting for 1/2/3
}

/** Admin pay-for-others session: stored while waiting for partner selection or voucher image */
export interface AdminPaySession {
  step: 'select_partner' | 'awaiting_image';
  month: number;
  year: number;
  unpaidPartners: Array<{ id: string; nombre: string; numeroRifa: number; montoCuota: number }>;
  selectedPartnerId?: string;
  selectedPartnerName?: string;
  selectedPartnerNumeroRifa?: number;
  selectedPartnerMontoCuota?: number;
}
