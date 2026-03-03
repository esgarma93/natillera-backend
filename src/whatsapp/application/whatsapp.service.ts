import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { UsersService } from '../../users/application/users.service';
import { RafflesService } from '../../raffles/application/raffles.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../../storage/storage.service';
import { OcrService } from './ocr.service';
import { VoucherParserService } from './voucher-parser.service';
import { UserRole } from '../../users/domain/user.entity';
import axios from 'axios';

// Redis key prefixes
const KEY_WA_AUTH = 'wa:auth:';
const KEY_WA_PENDING = 'wa:pending:';
const KEY_WA_SPONSOR = 'wa:sponsor:';
const KEY_WA_MONTH_CHOICE = 'wa:month_choice:';
const KEY_WA_VOUCHER_MONTH = 'wa:voucher_month:';

// TTLs in seconds
const AUTH_SESSION_TTL = 60 * 60;       // 1 hour
const PENDING_SESSION_TTL = 10 * 60;    // 10 minutes
// Admin phones read from WHATSAPP_NOTIFICATION_PHONES env var (comma-separated, e.g. "573122249196,573001234567")
// Falls back to a single number if the legacy ADMIN_PHONE env var is set, or empty list if neither is defined.

// Pending image session: stored while waiting for raffle number from user
interface PendingSession {
  imageId: string;
  imageUrl: string;
  messageId: string;
  detectedAmount: number | null;
  parsedVoucher: any;
  from: string;
  storageKey?: string;
}

// Pending sponsor choice: stored while waiting for user to confirm sponsored partner
interface PendingSponsorChoice {
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
  sponsoredOptions: Array<{
    id: string;
    nombre: string;
    numeroRifa: number;
    montoCuota: number;
  }>;
}

// Pending month choice: stored when payment date falls on day 6-14 (ambiguous billing period)
interface PendingMonthChoice {
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

// Authentication session per phone number
interface AuthSession {
  authenticated: boolean;
  attempts: number;       // failed PIN attempts
  waitingForPin: boolean; // true = bot asked for PIN, waiting response
  pendingCommand?: string; // command that triggered the PIN flow (e.g. 'menu')
  menuActive?: boolean;    // true = numbered menu was shown, waiting for 1/2/3
}

const MAX_PIN_ATTEMPTS = 3;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly graphApiUrl = 'https://graph.facebook.com/v18.0';

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly partnersService: PartnersService,
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => RafflesService))
    private readonly rafflesService: RafflesService,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly ocrService: OcrService,
    private readonly voucherParserService: VoucherParserService,
  ) {}

  /**
   * Build a short redirect URL for a payment voucher.
   * The backend /payments/:id/voucher endpoint redirects to the presigned URL.
   * This avoids WhatsApp truncating long presigned URLs.
   */
  private buildVoucherRedirectUrl(paymentId: string): string {
    const appUrl = (process.env.APP_URL || 'https://natillera-backend-production.up.railway.app').replace(/\/+$/, '');
    return `${appUrl}/payments/${paymentId}/voucher`;
  }

  /**
   * Verify webhook subscription (required by Meta)
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }

    this.logger.warn('Webhook verification failed');
    return null;
  }

  /**
   * Process incoming WhatsApp message
   */
  async processWebhook(body: any): Promise<void> {
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages?.length) {
        this.logger.log('No messages in webhook payload');
        return;
      }

      const message = value.messages[0];
      const contact = value.contacts?.[0];
      const from = message.from; // WhatsApp phone number

      this.logger.log(`Received message from ${from}, type: ${message.type}`);

      // Handle image messages (payment vouchers)
      if (message.type === 'image') {
        await this.handleImageMessage(message, from, contact);
      }

      // Handle text messages
      if (message.type === 'text') {
        await this.handleTextMessage(message, from);
      }
    } catch (error) {
      this.logger.error('Error processing webhook:', error);
    }
  }

  /**
   * Handle image message (payment voucher)
   */
  private async handleImageMessage(message: any, from: string, contact: any): Promise<void> {
    const imageId = message.image?.id;
    const caption = message.image?.caption || '';
    const messageId = message.id;

    this.logger.log(`Processing image message. ID: ${imageId}, Caption: ${caption}`);

    try {
      // Get image URL from WhatsApp
      const imageUrl = await this.getMediaUrl(imageId);

      if (!imageUrl) {
        await this.sendMessage(from, '❌ No se pudo procesar la imagen. Por favor intente de nuevo.');
        return;
      }

      // Download image binary for OCR + cloud storage
      const { buffer: imageBuffer, mimeType: imageMimeType } = await this.downloadMedia(imageUrl);

      // Try to extract text using OCR and parse voucher
      const ocrResult = await this.ocrService.extractAmountFromImage(imageUrl);
      const parsedVoucher = this.voucherParserService.parseVoucher(ocrResult.rawText || '');

      this.logger.log(`Parsed voucher: type=${parsedVoucher.type}, amount=${parsedVoucher.amount}, confidence=${parsedVoucher.confidence}`);

      // Check if voucher type is accepted (only Nequi and Bancolombia)
      if (!this.voucherParserService.isAcceptedVoucherType(parsedVoucher.type)) {
        await this.sendMessage(
          from,
          `❌ Comprobante rechazado.\n\n` +
            `⚠️ Solo se aceptan comprobantes de Nequi o Bancolombia.\n` +
            `Por favor envíe un comprobante válido.`,
        );
        
        // Log rejected voucher
        this.logger.warn(`Rejected voucher - Invalid type: ${parsedVoucher.type}, From: ${from}`);
        return;
      }

      // Try to extract partner info from caption
      const raffleNumber = this.extractRaffleNumber(caption);

      // Normalize the phone number (remove country prefix and non-digits)
      const normalizedPhone = this.normalizePhone(from);

      // Try to find partner by cellphone first
      let partner = await this.partnersService.findByCelular(normalizedPhone);

      if (!partner && raffleNumber) {
        partner = await this.partnersService.findByNumeroRifa(raffleNumber);
      }

      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const detectedAmount = parsedVoucher.amount || ocrResult.amount;

      // Upload voucher image to R2 cloud storage for persistence
      let persistentImageUrl = imageUrl;
      let persistentStorageKey: string | undefined;
      if (this.storageService.isEnabled() && imageBuffer) {
        const storageKey = this.storageService.buildVoucherKey(
          partner?.id || 'unknown',
          parsedVoucher.type || 'voucher',
          imageMimeType,
        );
        const r2Url = await this.storageService.uploadVoucher(imageBuffer, storageKey, imageMimeType);
        if (r2Url) {
          persistentImageUrl = r2Url;
          persistentStorageKey = storageKey;
          this.logger.log(`Voucher stored in R2: ${storageKey}`);
        }
      }

      if (partner) {
        await this.registerPaymentForPartner(from, partner, detectedAmount, parsedVoucher, persistentImageUrl, imageId, messageId, false, persistentStorageKey);
      } else {
        // Store pending session in Redis (TTL = 10 minutes, handled by Redis)
        await this.redisService.set(KEY_WA_PENDING + from, {
          imageId,
          imageUrl: persistentImageUrl,
          messageId,
          detectedAmount,
          parsedVoucher,
          from,
          storageKey: persistentStorageKey,
        }, PENDING_SESSION_TTL);

        const amountLine = detectedAmount
          ? `💰 Monto detectado: *$${detectedAmount.toLocaleString('es-CO')}*\n`
          : `💰 Monto: No detectado automáticamente\n`;

        await this.sendMessage(
          from,
          `📸 ¡Comprobante recibido!\n\n` +
            `🏦 Tipo: *${parsedVoucher.type.toUpperCase()}*\n` +
            amountLine +
            `📅 Mes: *${this.getMonthName(currentMonth)} ${currentYear}*\n\n` +
            `⚠️ No encontré un socio asociado a tu número *${normalizedPhone}*.\n\n` +
            `Por favor responde con:\n` +
            `• Tu *número de rifa* (ej: *#5* o simplemente *5*)\n` +
            `• O el *celular del socio* (ej: *3108214820*)\n\n` +
            `_Escribe CANCELAR para anular._`,
        );
      }

      this.logger.log(
        `Voucher received - From: ${from}, Partner: ${partner?.nombre || 'not found'}, ` +
          `Type: ${parsedVoucher.type}, Amount: ${detectedAmount}`,
      );
    } catch (error) {
      this.logger.error('Error handling image message:', error);
      await this.sendMessage(from, '❌ Ocurrió un error procesando el comprobante. Por favor intenta de nuevo.');
    }
  }

  /**
   * Register a payment for a found partner and send confirmation
   */
  private async registerPaymentForPartner(
    from: string,
    partner: any,
    detectedAmount: number | null,
    parsedVoucher: any,
    imageUrl: string,
    imageId: string,
    messageId: string,
    skipSponsorCheck: boolean = false,
    storageKey?: string,
    overrideBillingMonth?: number,
    overrideBillingYear?: number,
    latePenalty?: number,
  ): Promise<void> {
    // Use voucher date to determine payment month via billing period logic
    const voucherDate = parsedVoucher?.date || null;
    const paymentDate = voucherDate ? new Date(voucherDate) : new Date();

    let paymentMonth: number;
    let paymentYear: number;

    if (overrideBillingMonth !== undefined && overrideBillingYear !== undefined) {
      // Overridden by month choice handler (user already picked)
      paymentMonth = overrideBillingMonth;
      paymentYear = overrideBillingYear;
    } else {
      const billing = this.determineBillingPeriod(paymentDate);

      if (billing.status === 'ambiguous' && detectedAmount !== null) {
        // Day 6-14: ask user which month to assign the payment to
        await this.redisService.set(KEY_WA_MONTH_CHOICE + from, {
          partnerId: partner.id,
          detectedAmount,
          parsedVoucher,
          imageUrl,
          imageId,
          messageId,
          storageKey,
          skipSponsorCheck,
          lateMonth: billing.lateMonth!,
          lateYear: billing.lateYear!,
          onTimeMonth: billing.onTimeMonth!,
          onTimeYear: billing.onTimeYear!,
          daysLate: billing.daysLate!,
          penalty: billing.penalty!,
        } as PendingMonthChoice, PENDING_SESSION_TTL);

        await this.sendMessage(from,
          `📅 *¿Para qué mes quieres registrar este pago?*\n\n` +
          `💰 Monto detectado: *$${detectedAmount.toLocaleString('es-CO')}*\n` +
          `👤 Socio: *${partner.nombre}*\n\n` +
          `1️⃣ *${this.getMonthName(billing.lateMonth!)} ${billing.lateYear!}* — ⚠️ Multa: $${billing.penalty!.toLocaleString('es-CO')} (${billing.daysLate!} día${billing.daysLate! > 1 ? 's' : ''} de retraso)\n` +
          `2️⃣ *${this.getMonthName(billing.onTimeMonth!)} ${billing.onTimeYear!}* — ✅ A tiempo\n\n` +
          `_Responde *1* o *2*. Escribe *CANCELAR* para anular._`,
        );
        return;
      }

      paymentMonth = billing.month;
      paymentYear = billing.year;
    }

    // Fetch sponsor info if partner has one
    let sponsorLine = '';
    if (partner.idPartnerPatrocinador) {
      try {
        const sponsor = await this.partnersService.findById(partner.idPartnerPatrocinador);
        if (sponsor) {
          sponsorLine = `🤝 Patrocinador: *${sponsor.nombre}* (Rifa #${sponsor.numeroRifa})\n`;
        }
      } catch (_) { /* sponsor not found */ }
    }

    if (detectedAmount !== null) {
      // ── Sponsored partner detection ──
      if (!skipSponsorCheck && detectedAmount !== partner.montoCuota) {
        const allPartners = await this.partnersService.findAll();
        const sponsoredPartners = allPartners.filter(
          p => p.idPartnerPatrocinador === partner.id && p.activo,
        );
        const matchingSponsored = sponsoredPartners.filter(
          p => p.montoCuota === detectedAmount,
        );

        if (matchingSponsored.length > 0) {
          await this.redisService.set(KEY_WA_SPONSOR + from, {
            imageId, imageUrl, messageId, detectedAmount, parsedVoucher, from,
            originalPartnerId: partner.id,
            originalPartnerName: partner.nombre,
            originalPartnerMontoCuota: partner.montoCuota,
            storageKey,
            sponsoredOptions: matchingSponsored.map(p => ({
              id: p.id, nombre: p.nombre, numeroRifa: p.numeroRifa, montoCuota: p.montoCuota,
            })),
          } as PendingSponsorChoice, PENDING_SESSION_TTL);

          if (matchingSponsored.length === 1) {
            const sp = matchingSponsored[0];
            await this.sendMessage(from,
              `🤔 *El monto no coincide con tu cuota*\n\n` +
              `💰 Monto detectado: *$${detectedAmount.toLocaleString('es-CO')}*\n` +
              `💵 Tu cuota: *$${partner.montoCuota.toLocaleString('es-CO')}*\n\n` +
              `Pero coincide con la cuota de tu patrocinado:\n` +
              `👤 *${sp.nombre}* (Rifa #${sp.numeroRifa}) — $${sp.montoCuota.toLocaleString('es-CO')}\n\n` +
              `¿Este pago es para *${sp.nombre}*?\n` +
              `Responde *SÍ* o *NO*\n\n` +
              `_Escribe CANCELAR para anular._`,
            );
          } else {
            let msg =
              `🤔 *El monto no coincide con tu cuota*\n\n` +
              `💰 Monto detectado: *$${detectedAmount.toLocaleString('es-CO')}*\n` +
              `💵 Tu cuota: *$${partner.montoCuota.toLocaleString('es-CO')}*\n\n` +
              `Pero coincide con la cuota de estos patrocinados:\n\n`;
            matchingSponsored.forEach((sp, i) => {
              msg += `${i + 1}️⃣ *${sp.nombre}* (Rifa #${sp.numeroRifa}) — $${sp.montoCuota.toLocaleString('es-CO')}\n`;
            });
            msg += `\n¿Para quién es este pago?\n` +
              `Responde con el *número* (1, 2...) o *NO* si es para ti.\n\n` +
              `_Escribe CANCELAR para anular._`;
            await this.sendMessage(from, msg);
          }
          return;
        }
      }

      // ── Partial payment accumulation ──
      try {
        const existingPayment = await this.paymentsService.findExistingPayment(
          partner.id, paymentMonth, paymentYear,
        );

        if (existingPayment) {
          if (existingPayment.amount < existingPayment.expectedAmount) {
            await this.paymentsService.accumulatePartialPayment(
              existingPayment.id, detectedAmount,
            );

            const newTotal = existingPayment.amount + detectedAmount;
            const covered = newTotal >= existingPayment.expectedAmount;

            let msg =
              `📸 *¡Comprobante complementario recibido!*\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `👤 Socio: *${partner.nombre}*\n` +
              `🎰 Rifa: *#${partner.numeroRifa}*\n` +
              sponsorLine +
              `💰 Pago anterior: *$${existingPayment.amount.toLocaleString('es-CO')}*\n` +
              `💰 Este comprobante: *$${detectedAmount.toLocaleString('es-CO')}*\n` +
              `💰 Total acumulado: *$${newTotal.toLocaleString('es-CO')}*\n` +
              `💵 Cuota esperada: *$${existingPayment.expectedAmount.toLocaleString('es-CO')}*\n` +
              `📅 Mes: *${this.getMonthName(paymentMonth)} ${paymentYear}*\n` +
              `━━━━━━━━━━━━━━━━━━\n\n`;

            if (covered) {
              msg += `✅ *¡Pago completado!*\nSe acumularon ambos comprobantes exitosamente.\nSerá verificado pronto por el administrador.`;
            } else {
              const remaining = existingPayment.expectedAmount - newTotal;
              msg += `⚠️ *Pago parcial acumulado.*\nFaltan *$${remaining.toLocaleString('es-CO')}* para completar la cuota.`;
            }

            await this.sendMessage(from, msg);
            return;
          } else {
            await this.sendMessage(
              from,
              `⚠️ Ya existe un pago registrado para *${partner.nombre}* en *${this.getMonthName(paymentMonth)} ${paymentYear}* ` +
              `por *$${existingPayment.amount.toLocaleString('es-CO')}*.\n\n` +
              `Si crees que esto es un error, contacta al administrador.`,
            );
            return;
          }
        }
      } catch (checkErr) {
        this.logger.warn('Error checking existing payment for accumulation:', checkErr);
      }

      // ── Create new payment ──
      try {
        const validation = this.voucherParserService.validatePaymentVoucher(
          parsedVoucher,
          partner.montoCuota,
          paymentMonth,
          paymentYear,
        );

        // Add late penalty to validation issues if applicable
        if (latePenalty && latePenalty > 0) {
          const daysLate = Math.round(latePenalty / 2000);
          validation.issues.push(
            `Multa por pago tardío: $${latePenalty.toLocaleString('es-CO')} (${daysLate} día${daysLate > 1 ? 's' : ''} de retraso después del 5)`,
          );
        }

        const paymentResult = await this.paymentsService.createFromWhatsAppWithValidation(
          partner.id,
          detectedAmount,
          imageUrl,
          messageId,
          parsedVoucher.type,
          parsedVoucher.date,
          validation.issues,
          storageKey,
          from,
          paymentMonth,
        );

        this.logger.log(`Payment created for ${partner.nombre}, status: ${paymentResult.status}`);

        let responseMessage =
          `📸 *¡Comprobante de pago recibido!*\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 Socio: *${partner.nombre}*\n` +
          `🎰 Rifa: *#${partner.numeroRifa}*\n` +
          sponsorLine +
          `💰 Monto detectado: *$${detectedAmount.toLocaleString('es-CO')}*\n` +
          `💵 Cuota esperada: *$${partner.montoCuota.toLocaleString('es-CO')}*\n` +
          `📅 Mes: *${this.getMonthName(paymentMonth)} ${paymentYear}*\n` +
          (latePenalty && latePenalty > 0
            ? `⚠️ Multa por retraso: *$${latePenalty.toLocaleString('es-CO')}*\n`
            : '') +
          `🏦 Tipo: *${parsedVoucher.type.toUpperCase()}*\n` +
          `━━━━━━━━━━━━━━━━━━\n\n`;

        if (validation.issues.length > 0) {
          responseMessage +=
            `⚠️ Estado: *PENDIENTE DE REVISIÓN*\n\n` +
            `Observaciones:\n${validation.issues.map((i) => `• ${i}`).join('\n')}\n\n` +
            `El pago será revisado manualmente por un administrador.`;
        } else {
          responseMessage +=
            `✅ *¡Pago registrado exitosamente!*\n` +
            `Será verificado pronto por el administrador.\n\n` +
            `Si hay algún error, responde con el monto correcto.`;
        }

        await this.sendMessage(from, responseMessage);
      } catch (paymentError: any) {
        this.logger.error('Error creating payment:', paymentError);

        // Check if payment already exists for this month
        const isDuplicate = paymentError?.message?.toLowerCase().includes('already exists');
        if (isDuplicate) {
          await this.sendMessage(
            from,
            `⚠️ Ya existe un pago registrado para *${partner.nombre}* en *${this.getMonthName(paymentMonth)} ${paymentYear}*.\n\n` +
              `Si crees que esto es un error, contacta al administrador.`,
          );
        } else {
          await this.sendMessage(
            from,
            `📸 Comprobante recibido, pero ocurrió un error al registrar el pago.\n` +
              `Por favor contacta al administrador.`,
          );
        }

        // ALWAYS notify admins even on error, so they see the voucher
      }
    } else {
      // Amount not detected
      await this.sendMessage(
        from,
        `📸 *¡Comprobante recibido!*\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 Socio: *${partner.nombre}*\n` +
          `🎰 Rifa: *#${partner.numeroRifa}*\n` +
          sponsorLine +
          `💵 Cuota esperada: *$${partner.montoCuota.toLocaleString('es-CO')}*\n` +
          `🏦 Tipo: *${parsedVoucher.type?.toUpperCase() || 'Desconocido'}*\n` +
          `━━━━━━━━━━━━━━━━━━\n\n` +
          `⚠️ No se pudo detectar el monto automáticamente.\n\n` +
          `Por favor responde con el *monto del pago* (ej: *150000*).`,
      );
    }
  }

  /**
   * Extract raffle number from text (e.g., "#5", "Rifa 5", "rifa5")
   */
  private extractRaffleNumber(text: string): number | null {
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
  private getMonthName(month: number): string {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
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
  private determineBillingPeriod(date: Date): {
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
   * Handle text message
   */
  private async handleTextMessage(message: any, from: string): Promise<void> {
    const text = (message.text?.body || '').trim();
    const textLower = text.toLowerCase();

    this.logger.log(`Text message from ${from}: ${text}`);

    // ── If the user is mid-PIN-flow, collect their PIN first ──
    const authSession = await this.redisService.get<AuthSession>(KEY_WA_AUTH + from);
    if (authSession?.waitingForPin) {
      await this.handlePinInput(from, text, authSession);
      return;
    }

    // ── Pending sponsor choice (waiting for SÍ/NO or partner number) ──
    const sponsorChoice = await this.redisService.get<PendingSponsorChoice>(KEY_WA_SPONSOR + from);
    if (sponsorChoice) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_SPONSOR + from);
        await this.sendMessage(from, '✅ Registro cancelado.\n\nEnvía una foto de tu comprobante cuando quieras registrar un pago.');
        return;
      }
      await this.handleSponsorChoice(from, text, sponsorChoice);
      return;
    }

    // ── Pending month choice (day 6-14 ambiguous billing period) ──
    const monthChoice = await this.redisService.get<PendingMonthChoice>(KEY_WA_MONTH_CHOICE + from);
    if (monthChoice) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_MONTH_CHOICE + from);
        await this.sendMessage(from, '✅ Registro cancelado.\n\nEnvía una foto de tu comprobante cuando quieras registrar un pago.');
        return;
      }
      await this.handleMonthChoice(from, text, monthChoice);
      return;
    }

    // ── Pending voucher month query (admin waiting for month number for COMPROBANTES) ──
    const voucherMonthQuery = await this.redisService.get<{ active: boolean }>(KEY_WA_VOUCHER_MONTH + from);
    if (voucherMonthQuery) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_VOUCHER_MONTH + from);
        await this.sendMessage(from, '✅ Consulta cancelada.');
        return;
      }
      const monthNum = parseInt(text.trim(), 10);
      if (monthNum >= 1 && monthNum <= 12) {
        await this.redisService.del(KEY_WA_VOUCHER_MONTH + from);
        await this.sendMonthlyVouchers(from, `COMPROBANTES ${monthNum}`);
        return;
      }
      await this.sendMessage(from, '⚠️ Por favor ingresa un número de mes válido (1-12).\n\n_Escribe CANCELAR para anular._');
      return;
    }

    // ── Pending voucher session (partner not found, waiting for raffle number) ──
    const pendingSession = await this.redisService.get<PendingSession>(KEY_WA_PENDING + from);
    if (pendingSession) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_PENDING + from);
        await this.sendMessage(from, '✅ Registro cancelado.\n\nEnvía una foto de tu comprobante cuando quieras registrar un pago.');
        return;
      }

      const raffleNumber = this.extractRaffleNumber(text);
      if (raffleNumber !== null) {
        await this.resumeSessionWithRaffle(from, raffleNumber, pendingSession);
        return;
      }

      // 10-digit number → treat as cellphone lookup
      const digits = text.replace(/\D/g, '');
      if (digits.length === 10) {
        await this.resumeSessionWithCelular(from, digits, pendingSession);
        return;
      }

      // Plain short number (1–3 digits) without # prefix → raffle number
      const directNumber = parseInt(digits, 10);
      if (!isNaN(directNumber) && directNumber > 0 && directNumber < 1000) {
        await this.resumeSessionWithRaffle(from, directNumber, pendingSession);
        return;
      }

      await this.sendMessage(
        from,
        `⚠️ No entendí ese dato.\n\n` +
        `Por favor responde con:\n` +
        `• Tu *número de rifa* (ej: *#5* o simplemente *5*)\n` +
        `• O el *celular del socio* (ej: *3108214820*)\n` +
        `• O escribe *CANCELAR* para anular.`,
      );
      return;
    }

    // ── MENU command — ask for PIN, then show numbered options ──
    if (textLower === 'menu' || textLower === 'menú' || textLower === 'opciones') {
      if (authSession?.authenticated) {
        await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
        // Show numbered menu and set menuActive flag
        const isAdminUser = await this.isAdmin(from);
        await this.redisService.set(KEY_WA_AUTH + from, {
          ...authSession,
          menuActive: true,
        }, AUTH_SESSION_TTL);
        const normalizedPhone = this.normalizePhone(from);
        const partner = await this.partnersService.findByCelular(normalizedPhone);
        await this.sendNumberedMenu(from, partner?.nombre ?? 'Socio', isAdminUser);
      } else {
        await this.startAuthFlow(from, 'menu');
      }
      return;
    }

    // ── Numbered menu selection (1, 2, 3) when menu is active ──
    if (authSession?.authenticated && authSession?.menuActive && /^[1-3]$/.test(text.trim())) {
      await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
      // Clear menuActive flag
      await this.redisService.set(KEY_WA_AUTH + from, {
        ...authSession,
        menuActive: false,
      }, AUTH_SESSION_TTL);

      const option = parseInt(text.trim(), 10);
      if (option === 1) {
        await this.sendPartnerInfoWithVoucher(from);
      } else if (option === 2) {
        await this.sendLastRaffleWinner(from);
      } else if (option === 3) {
        if (await this.isAdmin(from)) {
          await this.sendMonthlyVouchers(from, 'COMPROBANTES');
        } else {
          await this.sendMessage(from, `⚠️ Esta opción está disponible solo para administradores.`);
        }
      }
      return;
    }

    // ── INFO command — requires PIN authentication ──
    if (textLower === 'info' || textLower === 'mi info' || textLower === 'mi información' || textLower === 'información') {
      if (authSession?.authenticated) {
        await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
        await this.sendPartnerInfo(from);
      } else {
        await this.startAuthFlow(from);
      }
      return;
    }

    // ── RECIBO command — send last voucher presigned URL (requires PIN authentication) ──
    if (textLower === 'recibo' || textLower === 'comprobante' || textLower === 'mi recibo' || textLower === 'mi comprobante') {
      if (authSession?.authenticated) {
        await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
        await this.sendLastVoucherUrl(from);
      } else {
        await this.startAuthFlow(from);
      }
      return;
    }

    // ── COMPROBANTES command — admin queries all vouchers for a month ──
    if (textLower.startsWith('comprobantes')) {
      if (authSession?.authenticated) {
        await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
        if (await this.isAdmin(from)) {
          await this.sendMonthlyVouchers(from, text);
        } else {
          await this.sendMessage(from, `⚠️ Este comando está disponible solo para administradores.`);
        }
      } else {
        await this.startAuthFlow(from);
      }
      return;
    }

    // ── Default: guide user ──
    await this.sendMessage(
      from,
      `🌿 *Hola, soy Nacho*\n\n` +
      `Puedes:\n` +
      `📸 Enviar una *foto* de tu comprobante (Nequi o Bancolombia) para registrar tu pago\n` +
      `ℹ️ Escribir *MENU* para ver más opciones\n\n` +
      `_(Requiere PIN) · Solo se aceptan comprobantes de Nequi o Bancolombia._`,
    );
  }

  // ─────────────────── AUTH HELPERS ───────────────────

  /**
   * Start the PIN authentication flow: look up user, send PIN request.
   */
  private async startAuthFlow(from: string, pendingCommand?: string): Promise<void> {
    const normalizedPhone = this.normalizePhone(from);

    // Check if phone is registered as a user
    const user = await this.usersService.findByCelular(normalizedPhone);

    if (!user) {
      await this.sendMessage(
        from,
        `🌿 *¡Hola! Soy Nacho, tu asistente de Natillera Chimba Verde!* 👋\n\n` +
        `Tu número no está registrado en el sistema todavía. 😅\n\n` +
        `Habla con el administrador para que te registre y puedas disfrutar de todos los beneficios. 🎉`,
      );
      return;
    }

    if (!user.activo) {
      await this.sendMessage(
        from,
        `� *¡Ups! Tu cuenta está desactivada.*\n\n` +
        `Soy Nacho 🌿 y lamentablemente no puedo ayudarte por ahora.\n\n` +
        `Contacta al administrador para que reactive tu cuenta.`,
      );
      return;
    }

    // Store auth session in Redis waiting for PIN (TTL = 10 min)
    await this.redisService.set(KEY_WA_AUTH + from, {
      authenticated: false,
      waitingForPin: true,
      attempts: 0,
      pendingCommand,
    }, PENDING_SESSION_TTL);

    await this.sendMessage(
      from,
      `🌿 *¡Hola! Soy Nacho, tu asistente de Natillera Chimba Verde!*\n\n` +
      `Para proteger tu cuenta, necesito verificar tu identidad primero. 🔐\n\n` +
      `Por favor ingresa tu *PIN* de 4 dígitos:\n\n` +
      `_¿Olvidaste tu PIN? Contacta al administrador._`,
    );
  }

  /**
   * Validate the PIN the user sent.
   */
  private async handlePinInput(from: string, pin: string, session: AuthSession): Promise<void> {
    const normalizedPhone = this.normalizePhone(from);
    const MAX_ATTEMPTS = MAX_PIN_ATTEMPTS;

    // Validate PIN via UsersService (checks activo + bcrypt compare)
    const user = await this.usersService.validateUser(normalizedPhone, pin);

    if (user) {
      // Success — store authenticated session in Redis with 1-hour TTL
      const isAdminUser = await this.isAdmin(from);
      const pendingCmd = session.pendingCommand;

      await this.redisService.set(KEY_WA_AUTH + from, {
        authenticated: true,
        waitingForPin: false,
        attempts: 0,
        menuActive: pendingCmd === 'menu',
      }, AUTH_SESSION_TTL);

      const partner = await this.partnersService.findByCelular(normalizedPhone);
      const name = partner?.nombre ?? user.celular;

      if (pendingCmd === 'menu') {
        // Show numbered menu right after successful PIN
        await this.sendNumberedMenu(from, name, isAdminUser);
      } else {
        let welcomeMsg =
          `✅ *¡Bienvenido/a, ${name}!* 🎉\n\n` +
          `Soy *Nacho* 🌿 y estoy listo para ayudarte.\n\n` +
          `📸 Envía una foto de tu comprobante para registrar un pago\n` +
          `ℹ️ Escribe *MENU* para ver más opciones`;

        await this.sendMessage(from, welcomeMsg);
      }
    } else {
      // Failed attempt
      session.attempts += 1;
      await this.redisService.set(KEY_WA_AUTH + from, session, PENDING_SESSION_TTL);

      const remaining = MAX_ATTEMPTS - session.attempts;

      if (remaining <= 0) {
        // Too many attempts — delete session (lock out)
        await this.redisService.del(KEY_WA_AUTH + from);
        await this.sendMessage(
          from,
          `� *¡Ay, demasiados intentos fallidos!*\n\n` +
          `Soy Nacho 🌿 y por tu seguridad he bloqueado el acceso temporalmente.\n\n` +
          `Contacta al administrador si olvidaste tu PIN.`,
        );
      } else {
        await this.sendMessage(
          from,
          `❌ *PIN incorrecto, ¡inténtalo de nuevo!*\n\n` +
          `Te quedan *${remaining}* intento${remaining === 1 ? '' : 's'}. 🤞\n\n` +
          `Ingresa tu PIN de 4 dígitos:`,
        );
      }
    }
  }

  /**
   * Send welcome/help message (used after auth success)
   */
  private async sendWelcomeMenu(from: string): Promise<void> {
    const normalizedPhone = this.normalizePhone(from);
    const partner = await this.partnersService.findByCelular(normalizedPhone);

    const greeting =
      `🌿 *¡Hola${partner ? `, ${partner.nombre}` : ''}! Soy Nacho, tu asistente de Natillera Chimba Verde* 🎉\n\n` +
      `📸 Envía una *foto* de tu comprobante de pago\n` +
      `📝 Escribe *MENU* para ver las opciones disponibles\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `_Solo se aceptan comprobantes de Nequi o Bancolombia._`;

    await this.sendMessage(from, greeting);
  }

  /**
   * Send the numbered menu. Options vary by role.
   */
  private async sendNumberedMenu(from: string, name: string, isAdmin: boolean): Promise<void> {
    let menuMsg =
      `📋 *Menú de opciones — ${name}*\n\n` +
      `1️⃣ Mi información, estado de pago y comprobante\n` +
      `2️⃣ Ganador de la última rifa\n`;

    if (isAdmin) {
      menuMsg += `3️⃣ Ver todos los comprobantes del mes\n`;
    }

    menuMsg += `\n_Responde con el *número* de la opción._`;

    await this.sendMessage(from, menuMsg);
  }

  /**
   * Send partner info card with payment status and next raffle date
   */
  private async sendPartnerInfo(from: string): Promise<void> {
    const normalizedPhone = this.normalizePhone(from);
    const partner = await this.partnersService.findByCelular(normalizedPhone);

    if (!partner) {
      await this.sendMessage(
        from,
        `⚠️ No encontré un socio asociado a tu número *${normalizedPhone}*.\n\n` +
          `Contacta al administrador para registrar tu número en el sistema.`,
      );
      return;
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Check if partner has paid this month
    const monthPayments = await this.paymentsService.findByMonthAndYear(currentMonth, currentYear);
    const currentMonthPayment = monthPayments.find(
      p => p.partnerId === partner.id && (p.status === 'verified' || p.status === 'pending'),
    );
    const paymentStatus = currentMonthPayment
      ? currentMonthPayment.status === 'verified'
        ? `✅ *Pagado* (verificado)`
        : `⏳ *Pendiente de verificación*`
      : `❌ *No registrado*`;

    // Next raffle date = last Friday of current month
    const nextRaffleDate = this.getLastFridayOfMonth(currentMonth, currentYear);
    const nextRaffleDateStr = `${nextRaffleDate.getDate()} de ${this.getMonthName(currentMonth)} de ${currentYear}`;

    let infoMsg =
      `👤 *Información de tu cuenta*\n\n` +
      `👤 Nombre: *${partner.nombre}*\n` +
      `🎰 Número de rifa: *#${partner.numeroRifa}*\n` +
      `💵 Cuota mensual: *$${partner.montoCuota.toLocaleString('es-CO')}*\n` +
      `📱 Celular: *${partner.celular || normalizedPhone}*\n` +
      `✅ Estado: *${partner.activo ? 'Activo' : 'Inactivo'}*\n`;

    // Sponsor info
    if (partner.idPartnerPatrocinador) {
      try {
        const sponsor = await this.partnersService.findById(partner.idPartnerPatrocinador);
        if (sponsor) {
          infoMsg += `🤝 *Patrocinador:* ${sponsor.nombre} (Rifa #${sponsor.numeroRifa})\n`;
        }
      } catch (_) { /* sponsor not found */ }
    }

    infoMsg +=
      `\n━━━━━━━━━━━━━━━━━━\n` +
      `📅 *Mes actual:* ${this.getMonthName(currentMonth)} ${currentYear}\n` +
      `💳 *Estado de pago:* ${paymentStatus}\n` +
      `🎲 *Próxima rifa:* ${nextRaffleDateStr}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n`;

    // Payment deadline = 5th of next month
    const deadlineMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const deadlineYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    const deadlineDateStr = `5 de ${this.getMonthName(deadlineMonth)} de ${deadlineYear}`;

    if (!currentMonthPayment) {
      infoMsg += `📸 Recuerda enviar tu comprobante antes del *${deadlineDateStr}* para participar en la rifa.`;
    } else {
      infoMsg += `📸 Para registrar un pago envía una foto de tu comprobante (Nequi o Bancolombia).`;
    }

    await this.sendMessage(from, infoMsg);
  }

  /**
   * Combined option: send partner info + payment status + last voucher in a single flow.
   */
  private async sendPartnerInfoWithVoucher(from: string): Promise<void> {
    const normalizedPhone = this.normalizePhone(from);
    const partner = await this.partnersService.findByCelular(normalizedPhone);

    if (!partner) {
      await this.sendMessage(
        from,
        `⚠️ No encontré un socio asociado a tu número *${normalizedPhone}*.\n\n` +
          `Contacta al administrador para registrar tu número en el sistema.`,
      );
      return;
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // ── Payment status ──
    const monthPayments = await this.paymentsService.findByMonthAndYear(currentMonth, currentYear);
    const currentMonthPayment = monthPayments.find(
      p => p.partnerId === partner.id && (p.status === 'verified' || p.status === 'pending'),
    );
    const paymentStatus = currentMonthPayment
      ? currentMonthPayment.status === 'verified'
        ? `✅ *Pagado* (verificado)`
        : `⏳ *Pendiente de verificación*`
      : `❌ *No registrado*`;

    // ── Next raffle date ──
    const nextRaffleDate = this.getLastFridayOfMonth(currentMonth, currentYear);
    const nextRaffleDateStr = `${nextRaffleDate.getDate()} de ${this.getMonthName(currentMonth)} de ${currentYear}`;

    let msg =
      `👤 *Tu cuenta — ${partner.nombre}*\n\n` +
      `🎰 Rifa: *#${partner.numeroRifa}*\n` +
      `💵 Cuota mensual: *$${partner.montoCuota.toLocaleString('es-CO')}*\n` +
      `✅ Estado: *${partner.activo ? 'Activo' : 'Inactivo'}*\n`;

    // Sponsor info
    if (partner.idPartnerPatrocinador) {
      try {
        const sponsor = await this.partnersService.findById(partner.idPartnerPatrocinador);
        if (sponsor) {
          msg += `🤝 Patrocinador: *${sponsor.nombre}* (Rifa #${sponsor.numeroRifa})\n`;
        }
      } catch (_) { /* sponsor not found */ }
    }

    msg +=
      `\n━━━━━━━━━━━━━━━━━━\n` +
      `📅 *${this.getMonthName(currentMonth)} ${currentYear}*\n` +
      `💳 Estado de pago: ${paymentStatus}\n` +
      `🎲 Próxima rifa: *${nextRaffleDateStr}*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n`;

    // ── Last voucher ──
    try {
      const payments = await this.paymentsService.findByPartnerId(partner.id);
      const withVoucher = payments
        .filter(p => p.voucherImageUrl || p.voucherStorageKey)
        .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());

      if (withVoucher.length > 0) {
        const last = withVoucher[0];
        const statusEmoji = last.status === 'verified' ? '✅' : last.status === 'pending' ? '⏳' : '❌';
        const statusText = last.status === 'verified' ? 'Verificado' : last.status === 'pending' ? 'Pendiente' : 'Rechazado';
        const voucherUrl = this.buildVoucherRedirectUrl(last.id);

        msg +=
          `🧾 *Último comprobante*\n` +
          `💰 $${last.amount.toLocaleString('es-CO')} — ${this.getMonthName(last.month)} ${last.periodYear || ''}\n` +
          `${statusEmoji} ${statusText}\n` +
          `🔗 ${voucherUrl}\n`;
      } else {
        msg += `📋 _No tienes comprobantes registrados aún._\n`;
        msg += `📸 Envía una foto de tu comprobante para registrar tu primer pago.\n`;
      }
    } catch (err) {
      this.logger.error('Error fetching voucher in combined info:', err);
    }

    await this.sendMessage(from, msg);
  }

  /**
   * Send the last (most recent) raffle result to the user.
   */
  private async sendLastRaffleWinner(from: string): Promise<void> {
    try {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      // Try current month first, then previous month
      let raffle = await this.rafflesService.findByMonthAndYear(currentMonth, currentYear);

      if (!raffle || raffle.status === 'pending') {
        // Try previous month
        const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
        raffle = await this.rafflesService.findByMonthAndYear(prevMonth, prevYear);
      }

      if (!raffle || raffle.status === 'pending') {
        await this.sendMessage(
          from,
          `🎰 *Última rifa*\n\n` +
          `No se ha realizado ningún sorteo recientemente.\n\n` +
          `_El sorteo se realiza el sábado después del último viernes de cada mes._`,
        );
        return;
      }

      const monthName = raffle.monthName || this.getMonthName(raffle.month);

      let msg =
        `🎰 *Rifa de ${monthName} ${raffle.year}*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🔢 Lotería de Medellín: *${raffle.lotteryNumber || '—'}*\n` +
        `🎯 Últimas dos cifras: *${raffle.winningDigits || '—'}*\n` +
        `💰 Recaudado: *$${raffle.totalCollected.toLocaleString('es-CO')}*\n` +
        `🏆 Premio: *$${raffle.prizeAmount.toLocaleString('es-CO')}*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n`;

      if (raffle.status === 'completed' && raffle.winnerName) {
        msg +=
          `🎉 *¡Ganador: ${raffle.winnerName}!*\n` +
          `🎰 Número de rifa: *#${raffle.winnerRaffleNumber}*\n\n` +
          `¡Felicitaciones! 🥳`;
      } else if (raffle.status === 'no_winner') {
        msg +=
          `😔 *No hubo ganador este mes.*\n\n` +
          `El monto de *$${raffle.remainingAmount.toLocaleString('es-CO')}* queda acumulado. 🏦`;
      }

      await this.sendMessage(from, msg);
    } catch (error) {
      this.logger.error('Error sending last raffle winner:', error);
      await this.sendMessage(
        from,
        `❌ Ocurrió un error al consultar la rifa.\nPor favor intenta de nuevo.`,
      );
    }
  }
  /**
   * Send the last voucher image to the user via WhatsApp.
   * Looks up the partner's most recent payment that has a voucher.
   * Sends a text message with payment info and a presigned URL to view the image.
   */
  private async sendLastVoucherUrl(from: string): Promise<void> {
    const normalizedPhone = this.normalizePhone(from);
    const partner = await this.partnersService.findByCelular(normalizedPhone);

    if (!partner) {
      await this.sendMessage(
        from,
        `⚠️ No encontré un socio asociado a tu número *${normalizedPhone}*.\n\n` +
          `Contacta al administrador para registrar tu número en el sistema.`,
      );
      return;
    }

    try {
      // Get all payments for this partner, sorted by date (newest first)
      const payments = await this.paymentsService.findByPartnerId(partner.id);
      const withVoucher = payments
        .filter(p => p.voucherImageUrl || p.voucherStorageKey)
        .sort((a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime());

      if (withVoucher.length === 0) {
        await this.sendMessage(
          from,
          `📋 No encontré comprobantes registrados para *${partner.nombre}*.\n\n` +
            `📸 Envía una foto de tu comprobante para registrar tu primer pago.`,
        );
        return;
      }

      const lastPayment = withVoucher[0];
      const statusEmoji = lastPayment.status === 'verified' ? '✅' : lastPayment.status === 'pending' ? '⏳' : '❌';
      const statusText = lastPayment.status === 'verified' ? 'Verificado' : lastPayment.status === 'pending' ? 'Pendiente' : 'Rechazado';

      const voucherUrl = this.buildVoucherRedirectUrl(lastPayment.id);

      let msg =
        `🧾 *Último comprobante registrado*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 Socio: *${partner.nombre}*\n` +
        `🎰 Rifa: *#${partner.numeroRifa}*\n` +
        `💰 Monto: *$${lastPayment.amount.toLocaleString('es-CO')}*\n` +
        `📅 Mes: *${this.getMonthName(lastPayment.month)} ${lastPayment.periodYear || ''}*\n` +
        `${statusEmoji} Estado: *${statusText}*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `🔗 *Ver comprobante:*\n${voucherUrl}`;

      await this.sendMessage(from, msg);
    } catch (error) {
      this.logger.error('Error sending last voucher URL:', error);
      await this.sendMessage(
        from,
        `❌ Ocurrió un error al recuperar tu comprobante.\nPor favor intenta de nuevo.`,
      );
    }
  }

  /**
   * Admin command: send all voucher images for a given month.
   * Usage: COMPROBANTES (current month) or COMPROBANTES <month_number> (e.g. COMPROBANTES 6)
   */
  private async sendMonthlyVouchers(from: string, rawText: string): Promise<void> {
    try {
      // Parse optional month number from text (e.g. "COMPROBANTES 6" → month 6)
      const parts = rawText.trim().split(/\s+/);
      const now = new Date();
      let month = now.getMonth() + 1;
      let year = now.getFullYear();

      if (parts.length >= 2) {
        const parsed = parseInt(parts[1], 10);
        if (parsed >= 1 && parsed <= 12) {
          month = parsed;
          // If user queries a future month, assume previous year
          if (month > now.getMonth() + 1) {
            year = now.getFullYear() - 1;
          }
        }
      } else {
        // No month specified → ask which month to query
        await this.redisService.set(KEY_WA_VOUCHER_MONTH + from, { active: true }, PENDING_SESSION_TTL);
        await this.sendMessage(from,
          `📋 *¿De qué mes quieres ver los comprobantes?*\n\n` +
          `Ingresa el número del mes (1-12):\n` +
          `1 = Enero, 2 = Febrero, 3 = Marzo,\n` +
          `4 = Abril, 5 = Mayo, 6 = Junio,\n` +
          `7 = Julio, 8 = Agosto, 9 = Septiembre,\n` +
          `10 = Octubre, 11 = Noviembre, 12 = Diciembre\n\n` +
          `_Escribe CANCELAR para anular._`,
        );
        return;
      }

      const payments = await this.paymentsService.findByMonthAndYear(month, year);
      const withVoucher = payments.filter(p => p.voucherImageUrl || p.voucherStorageKey);

      if (withVoucher.length === 0) {
        await this.sendMessage(
          from,
          `📋 No se encontraron comprobantes para *${this.getMonthName(month)} ${year}*.\n\n` +
          `_Usa *COMPROBANTES <mes>* (ej: COMPROBANTES 6) para consultar otro mes._`,
        );
        return;
      }

      // Build a single text message with all vouchers and their presigned URLs
      let msg =
        `📋 *Comprobantes de ${this.getMonthName(month)} ${year}*\n` +
        `Total: *${withVoucher.length}* comprobante${withVoucher.length === 1 ? '' : 's'}\n\n`;

      for (const payment of withVoucher) {
        const statusEmoji = payment.status === 'verified' ? '✅' : payment.status === 'pending' ? '⏳' : '❌';
        const voucherUrl = this.buildVoucherRedirectUrl(payment.id);

        msg += `${statusEmoji} *${payment.partnerName || 'Socio'}* — $${payment.amount.toLocaleString('es-CO')}\n`;
        msg += `🔗 ${voucherUrl}\n\n`;
      }

      msg += `━━━━━━━━━━━━━━━━━━`;

      // WhatsApp max message length is ~65536 chars; split if needed
      if (msg.length > 4096) {
        // Send in chunks
        const lines = msg.split('\n');
        let chunk = '';
        for (const line of lines) {
          if ((chunk + '\n' + line).length > 4000 && chunk.length > 0) {
            await this.sendMessage(from, chunk);
            chunk = line;
          } else {
            chunk = chunk ? chunk + '\n' + line : line;
          }
        }
        if (chunk) await this.sendMessage(from, chunk);
      } else {
        await this.sendMessage(from, msg);
      }
    } catch (error) {
      this.logger.error('Error sending monthly vouchers:', error);
      await this.sendMessage(
        from,
        `❌ Ocurrió un error al consultar los comprobantes.\nPor favor intenta de nuevo.`,
      );
    }
  }

  /**
   * Resolve the best accessible URL for a voucher image.
   * Uses Redis-cached presigned URLs (55 min TTL) to avoid regenerating each time.
   */
  private async resolveVoucherUrl(paymentId: string, storageKey?: string, fallbackUrl?: string): Promise<string | null> {
    return this.storageService.getCachedPresignedUrl(paymentId, storageKey, fallbackUrl);
  }

  /**
   * Returns the last Friday of a given month
   */
  private getLastFridayOfMonth(month: number, year: number): Date {
    const lastDay = new Date(year, month, 0);
    for (let day = lastDay.getDate(); day >= lastDay.getDate() - 6; day--) {
      const date = new Date(year, month - 1, day);
      if (date.getDay() === 5) return date;
    }
    return lastDay;
  }

  /**
   * Cron: notify unpaid active partners on day 5 of each month at 9:00 AM.
   * Only notifies partners who have NOT paid for the current month.
   */
  @Cron('0 9 5 * *')
  async notifyUnpaidPartners(): Promise<void> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthName = this.getMonthName(month);
    const nextRaffleDate = this.getLastFridayOfMonth(month, year);
    const nextRaffleDateStr = `${nextRaffleDate.getDate()} de ${monthName} de ${year}`;

    this.logger.log(`Running payment reminder cron for ${monthName} ${year}`);

    try {
      const partners = await this.partnersService.findAll();
      const activePartners = partners.filter(p => p.activo && p.celular);
      const payments = await this.paymentsService.findByMonthAndYear(month, year);

      let notified = 0;
      for (const partner of activePartners) {
        // Check if partner already paid for the CURRENT month (verified or pending)
        const hasPaidCurrentMonth = payments.some(
          p => p.partnerId === partner.id && (p.status === 'verified' || p.status === 'pending'),
        );

        // Only notify if the partner has NOT paid for the current month
        if (!hasPaidCurrentMonth) {
          const whatsappNumber = `57${partner.celular!.replace(/\D/g, '')}`;
          try {
            await this.sendMessage(
              whatsappNumber,
              `🔔 *Recordatorio de pago - ${monthName} ${year}*\n\n` +
              `Hola *${partner.nombre}* 👋\n\n` +
              `Soy Nacho 🌿 y te recuerdo que aún no hemos recibido tu pago de *${monthName} ${year}*.\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `🎰 Tu número de rifa: *#${partner.numeroRifa}*\n` +
              `💵 Cuota: *$${partner.montoCuota.toLocaleString('es-CO')}*\n` +
              `📅 Fecha límite: *${nextRaffleDateStr}*\n` +
              `━━━━━━━━━━━━━━━━━━\n\n` +
              `📸 Envíame una foto de tu comprobante (Nequi o Bancolombia) para quedar al día. ¡Recuerda que debes pagar para participar en la rifa! 🏆`,
            );
            notified++;
          } catch (err) {
            this.logger.error(`Failed to send reminder to ${partner.nombre} (${whatsappNumber}):`, err);
          }
        }
      }

      this.logger.log(`Payment reminders sent: ${notified} of ${activePartners.length} active partners`);
    } catch (error) {
      this.logger.error('Error running payment reminder cron:', error);
    }
  }

  /**
   * Resume a pending session once the raffle number is provided
   */
  private async resumeSessionWithRaffle(from: string, raffleNumber: number, session: PendingSession): Promise<void> {
    await this.redisService.del(KEY_WA_PENDING + from);

    const partner = await this.partnersService.findByNumeroRifa(raffleNumber);

    if (!partner) {
      await this.sendMessage(
        from,
        `❌ No encontré ningún socio con el número de rifa *#${raffleNumber}*.\n\n` +
          `Intenta de nuevo con tu *número de rifa* o *celular del socio*,\n` +
          `o envía la imagen del comprobante nuevamente.`,
      );
      return;
    }

    await this.registerPaymentForPartner(from, partner, session.detectedAmount, session.parsedVoucher, session.imageUrl, session.imageId, session.messageId, false, session.storageKey);
  }

  /**
   * Resume a pending session using the partner's cellphone number
   */
  private async resumeSessionWithCelular(from: string, celular: string, session: PendingSession): Promise<void> {
    await this.redisService.del(KEY_WA_PENDING + from);

    const partner = await this.partnersService.findByCelular(celular);

    if (!partner) {
      await this.sendMessage(
        from,
        `❌ No encontré ningún socio con el celular *${celular}*.\n\n` +
          `Intenta de nuevo con tu *número de rifa* o *celular del socio*,\n` +
          `o envía la imagen del comprobante nuevamente.`,
      );
      return;
    }

    await this.registerPaymentForPartner(from, partner, session.detectedAmount, session.parsedVoucher, session.imageUrl, session.imageId, session.messageId, false, session.storageKey);
  }

  /**
   * Handle the user's response when asked whether a payment is for a sponsored partner.
   */
  private async handleSponsorChoice(from: string, text: string, choice: PendingSponsorChoice): Promise<void> {
    const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    if (choice.sponsoredOptions.length === 1) {
      // Single sponsored option → SÍ / NO
      if (textLower === 'si' || textLower === 'sí' || textLower === 'yes' || textLower === '1') {
        await this.redisService.del(KEY_WA_SPONSOR + from);
        const sponsored = choice.sponsoredOptions[0];
        const partner = await this.partnersService.findById(sponsored.id);
        if (partner) {
          await this.registerPaymentForPartner(
            from, partner, choice.detectedAmount, choice.parsedVoucher,
            choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
          );
        }
      } else if (textLower === 'no' || textLower === '2') {
        await this.redisService.del(KEY_WA_SPONSOR + from);
        const partner = await this.partnersService.findById(choice.originalPartnerId);
        if (partner) {
          await this.registerPaymentForPartner(
            from, partner, choice.detectedAmount, choice.parsedVoucher,
            choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
          );
        }
      } else {
        // Didn't understand — ask again (keep session alive)
        await this.sendMessage(from,
          `⚠️ No entendí tu respuesta.\n\n` +
          `Responde *SÍ* para registrar el pago a nombre de *${choice.sponsoredOptions[0].nombre}*,\n` +
          `o *NO* para registrarlo a tu nombre (*${choice.originalPartnerName}*).\n\n` +
          `_Escribe CANCELAR para anular._`,
        );
      }
    } else {
      // Multiple sponsored options → pick by number or NO
      if (textLower === 'no') {
        await this.redisService.del(KEY_WA_SPONSOR + from);
        const partner = await this.partnersService.findById(choice.originalPartnerId);
        if (partner) {
          await this.registerPaymentForPartner(
            from, partner, choice.detectedAmount, choice.parsedVoucher,
            choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
          );
        }
      } else {
        const num = parseInt(text.replace(/\D/g, ''), 10);
        if (num >= 1 && num <= choice.sponsoredOptions.length) {
          await this.redisService.del(KEY_WA_SPONSOR + from);
          const sponsored = choice.sponsoredOptions[num - 1];
          const partner = await this.partnersService.findById(sponsored.id);
          if (partner) {
            await this.registerPaymentForPartner(
              from, partner, choice.detectedAmount, choice.parsedVoucher,
              choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
            );
          }
        } else {
          // Didn't understand
          await this.sendMessage(from,
            `⚠️ No entendí tu respuesta.\n\n` +
            `Responde con el *número* del patrocinado (1-${choice.sponsoredOptions.length}),\n` +
            `o *NO* para registrar el pago a tu nombre (*${choice.originalPartnerName}*).\n\n` +
            `_Escribe CANCELAR para anular._`,
          );
        }
      }
    }
  }

  /**
   * Handle the user's response when asked which month to assign a payment to (day 6-14 ambiguous period).
   * Option 1 = current month (late, with penalty), Option 2 = next month (on time).
   */
  private async handleMonthChoice(from: string, text: string, choice: PendingMonthChoice): Promise<void> {
    const option = text.trim();

    if (option === '1') {
      // Late payment for previous month (with penalty)
      await this.redisService.del(KEY_WA_MONTH_CHOICE + from);
      const partner = await this.partnersService.findById(choice.partnerId);
      if (!partner) {
        await this.sendMessage(from, '❌ No se encontró el socio. Intenta enviar el comprobante de nuevo.');
        return;
      }
      await this.registerPaymentForPartner(
        from, partner, choice.detectedAmount, choice.parsedVoucher,
        choice.imageUrl, choice.imageId, choice.messageId,
        choice.skipSponsorCheck, choice.storageKey,
        choice.lateMonth, choice.lateYear, choice.penalty,
      );
    } else if (option === '2') {
      // On-time payment for current month
      await this.redisService.del(KEY_WA_MONTH_CHOICE + from);
      const partner = await this.partnersService.findById(choice.partnerId);
      if (!partner) {
        await this.sendMessage(from, '❌ No se encontró el socio. Intenta enviar el comprobante de nuevo.');
        return;
      }
      await this.registerPaymentForPartner(
        from, partner, choice.detectedAmount, choice.parsedVoucher,
        choice.imageUrl, choice.imageId, choice.messageId,
        choice.skipSponsorCheck, choice.storageKey,
        choice.onTimeMonth, choice.onTimeYear, 0,
      );
    } else {
      // Didn't understand — ask again
      await this.sendMessage(from,
        `⚠️ No entendí tu respuesta.\n\n` +
        `Responde *1* para *${this.getMonthName(choice.lateMonth)} ${choice.lateYear}* (con multa de $${choice.penalty.toLocaleString('es-CO')})\n` +
        `o *2* para *${this.getMonthName(choice.onTimeMonth)} ${choice.onTimeYear}* (a tiempo).\n\n` +
        `_Escribe CANCELAR para anular._`,
      );
    }
  }

  /**
   * Return the list of admin phone numbers from the DB (users with role ADMIN).
   * Phone numbers are returned in WhatsApp E.164 format (e.g. "573122249196").
   */
  private async getAdminPhones(): Promise<string[]> {
    const admins = await this.usersService.findByRole(UserRole.ADMIN);
    return admins
      .map(u => u.celular ? `57${u.celular}` : '')
      .filter(p => p.length > 0);
  }

  /**
   * Check if a WhatsApp phone number (E.164 without '+') belongs to an admin user.
   */
  private async isAdmin(from: string): Promise<boolean> {
    const phones = await this.getAdminPhones();
    return phones.includes(from);
  }

  private async getMediaUrl(mediaId: string): Promise<string | null> {
    try {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;

      const response = await axios.get(`${this.graphApiUrl}/${mediaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      return response.data?.url || null;
    } catch (error) {
      this.logger.error('Error getting media URL:', error);
      return null;
    }
  }

  /**
   * Download a WhatsApp media file by its URL and return the buffer + mime type.
   */
  private async downloadMedia(mediaUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const downloadRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    const buffer = Buffer.from(downloadRes.data);
    const mimeType = (downloadRes.headers['content-type'] as string) || 'image/jpeg';
    return { buffer, mimeType };
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(to: string, text: string): Promise<void> {
    try {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      await axios.post(
        `${this.graphApiUrl}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(`Message sent to ${to}`);
    } catch (error) {
      this.logger.error('Error sending message:', error);
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
  private normalizePhone(from: string): string {
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
}
