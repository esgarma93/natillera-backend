// ─────────────────── REDIS KEY PREFIXES ───────────────────
export const KEY_WA_AUTH = 'wa:auth:';
export const KEY_WA_PENDING = 'wa:pending:';
export const KEY_WA_SPONSOR = 'wa:sponsor:';
export const KEY_WA_MONTH_CHOICE = 'wa:month_choice:';
export const KEY_WA_VOUCHER_MONTH = 'wa:voucher_month:';
export const KEY_WA_INTEGRATION_LIST = 'wa:integration_list:';
export const KEY_WA_ADMIN_PAY = 'wa:admin_pay:';
export const KEY_WA_INTEGRATION_CHOICE = 'wa:integration_choice:';
export const KEY_WA_COMBO_ALLOC = 'wa:combo_alloc:';
export const KEY_WA_GUEST_NAME = 'wa:guest_name:';

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

/** Pending integration-vs-quota choice: stored while waiting for user to say quota or integration */
export interface PendingIntegrationChoice {
  partnerId: string;
  partnerName: string;
  partnerMontoCuota: number;
  detectedAmount: number;
  parsedVoucher: any;
  imageUrl: string;
  imageId: string;
  messageId: string;
  storageKey?: string;
  billingMonth: number;
  billingYear: number;
  latePenalty?: number;
  integrationId: string;
  integrationName: string;
  integrationTotalCostPerPerson: number;
  integrationAbsentPenalty: number;
}

/** A single payment allocation within a combo payment */
export interface ComboAllocationItem {
  type: 'quota' | 'integration';
  partnerId: string;
  partnerName: string;
  amount: number;
  /** Only for integration payments */
  integrationId?: string;
  integrationName?: string;
  isAbsent?: boolean;
  /** true if this allocation is for a guest (not a registered partner) */
  isGuest?: boolean;
  guestName?: string;
  /** Invited by which partner */
  invitedByPartnerId?: string;
}

/** A selectable option in the combo allocation menu */
export interface ComboOption {
  label: string;
  cost: number;
  allocations: ComboAllocationItem[];
}

/**
 * Combo allocation session: handles a single voucher that covers multiple payments
 * (own quota + own integration + sponsored partners + guests).
 * Replaces PendingIntegrationChoice with a richer multi-step flow.
 */
export interface PendingComboAllocation {
  /** Main partner info */
  partnerId: string;
  partnerName: string;
  partnerMontoCuota: number;
  /** Original detected amount */
  detectedAmount: number;
  /** Amount remaining after allocations so far */
  remainingAmount: number;
  parsedVoucher: any;
  imageUrl: string;
  imageId: string;
  messageId: string;
  storageKey?: string;
  billingMonth: number;
  billingYear: number;
  latePenalty?: number;
  /** Integration details */
  integrationId: string;
  integrationName: string;
  integrationTotalCostPerPerson: number;
  integrationAbsentPenalty: number;
  /** Allocations committed so far */
  committedAllocations: ComboAllocationItem[];
  /** Current step in the multi-step flow */
  step: 'main_choice' | 'sponsored_choice' | 'guest_offer';
  /** Numbered options presented to the user at the current step */
  currentOptions: ComboOption[];
  /** For sponsored_choice: the sponsored partners to show */
  sponsoredOptions?: Array<{ id: string; nombre: string; numeroRifa: number; montoCuota: number }>;
}

/** Pending guest name: stored while waiting for the user to type the guest's name */
export interface PendingGuestName {
  combo: PendingComboAllocation;
}

