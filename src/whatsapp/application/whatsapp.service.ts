import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { UsersService } from '../../users/application/users.service';
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

// Authentication session per phone number
interface AuthSession {
  authenticated: boolean;
  attempts: number;       // failed PIN attempts
  waitingForPin: boolean; // true = bot asked for PIN, waiting response
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
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly ocrService: OcrService,
    private readonly voucherParserService: VoucherParserService,
  ) {}

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
  ): Promise<void> {
    // Use voucher date to determine payment month (same logic as createFromWhatsAppWithValidation)
    const voucherDate = parsedVoucher?.date || null;
    const paymentDate = voucherDate ? new Date(voucherDate) : new Date();
    const paymentMonth = paymentDate.getMonth() + 1;
    const paymentYear = paymentDate.getFullYear();

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

            // Forward to admin (independent try-catch)
            await this.notifyAdminsVoucher(imageId, partner, detectedAmount, parsedVoucher, paymentMonth, paymentYear,
              `📥 *Comprobante complementario WhatsApp*\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `👤 *${partner.nombre}* (Rifa #${partner.numeroRifa})\n` +
              `💰 Anterior: $${existingPayment.amount.toLocaleString('es-CO')} + Nuevo: $${detectedAmount.toLocaleString('es-CO')} = *$${newTotal.toLocaleString('es-CO')}*\n` +
              `💵 Cuota: $${existingPayment.expectedAmount.toLocaleString('es-CO')}\n` +
              `📅 Mes: *${this.getMonthName(paymentMonth)} ${paymentYear}*\n` +
              `💳 Estado: *${covered ? 'Cuota completada' : 'Aún parcial'}*\n` +
              `━━━━━━━━━━━━━━━━━━`,
            );
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

        const paymentResult = await this.paymentsService.createFromWhatsAppWithValidation(
          partner.id,
          detectedAmount,
          imageUrl,
          messageId,
          parsedVoucher.type,
          parsedVoucher.date,
          validation.issues,
          storageKey,
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

        // Forward voucher image to admin (independent try-catch)
        const statusText = validation.issues.length > 0 ? 'PENDIENTE DE REVISIÓN' : 'Pendiente de verificación';
        const issuesText = validation.issues.length > 0
          ? `\n⚠️ ${validation.issues.map((i) => `• ${i}`).join('\n⚠️ ')}`
          : '';
        await this.notifyAdminsVoucher(imageId, partner, detectedAmount, parsedVoucher, paymentMonth, paymentYear,
          `📥 *Nuevo comprobante WhatsApp*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 *${partner.nombre}* (Rifa #${partner.numeroRifa})\n` +
          `💰 Monto: *$${detectedAmount.toLocaleString('es-CO')}* — ${parsedVoucher.type.toUpperCase()}\n` +
          `📅 Mes: *${this.getMonthName(paymentMonth)} ${paymentYear}*\n` +
          `💳 Estado: *${statusText}*\n` +
          `━━━━━━━━━━━━━━━━━━` +
          issuesText,
        );
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
        await this.notifyAdminsVoucher(imageId, partner, detectedAmount, parsedVoucher, paymentMonth, paymentYear,
          `⚠️ *Comprobante con ERROR — WhatsApp*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 *${partner.nombre}* (Rifa #${partner.numeroRifa})\n` +
          `💰 Monto: *$${detectedAmount.toLocaleString('es-CO')}* — ${parsedVoucher.type?.toUpperCase() || '?'}\n` +
          `📅 Mes: *${this.getMonthName(paymentMonth)} ${paymentYear}*\n` +
          `❌ Error: ${paymentError?.message || 'Error desconocido'}\n` +
          `━━━━━━━━━━━━━━━━━━`,
        );
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

    // ── RECIBO command — send last voucher image (admin-only, requires PIN authentication) ──
    if (textLower === 'recibo' || textLower === 'comprobante' || textLower === 'mi recibo' || textLower === 'mi comprobante') {
      if (authSession?.authenticated) {
        await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
        if (await this.isAdmin(from)) {
          await this.sendLastVoucherImage(from);
        } else {
          await this.sendMessage(from, `⚠️ Este comando está disponible solo para administradores.`);
        }
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
    let defaultMsg =
      `🌿 *Hola, soy Nacho*\n\n` +
      `Puedes:\n` +
      `📸 Enviar una *foto* de tu comprobante (Nequi o Bancolombia) para registrar tu pago\n` +
      `ℹ️ Escribir *INFO* para ver tu información y estado de pago\n`;

    if (await this.isAdmin(from)) {
      defaultMsg +=
        `🧾 Escribir *RECIBO* para ver tu último comprobante\n` +
        `📋 Escribir *COMPROBANTES* para ver todos los comprobantes del mes\n`;
    }

    defaultMsg += `\n_(Requiere PIN) · Solo se aceptan comprobantes de Nequi o Bancolombia._`;

    await this.sendMessage(from, defaultMsg);
  }

  // ─────────────────── AUTH HELPERS ───────────────────

  /**
   * Start the PIN authentication flow: look up user, send PIN request.
   */
  private async startAuthFlow(from: string): Promise<void> {
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
      await this.redisService.set(KEY_WA_AUTH + from, {
        authenticated: true,
        waitingForPin: false,
        attempts: 0,
      }, AUTH_SESSION_TTL);

      const partner = await this.partnersService.findByCelular(normalizedPhone);
      const name = partner?.nombre ?? user.celular;

      let welcomeMsg =
        `✅ *¡Bienvenido/a, ${name}!* 🎉\n\n` +
        `Soy *Nacho* 🌿 y estoy listo para ayudarte.\n\n` +
        `📸 Envía una foto de tu comprobante para registrar un pago\n` +
        `ℹ️ Escribe *INFO* para ver tu información y estado de pago`;

      if (await this.isAdmin(from)) {
        welcomeMsg +=
          `\n🧾 Escribe *RECIBO* para ver tu último comprobante` +
          `\n📋 Escribe *COMPROBANTES* para ver todos los comprobantes del mes`;
      }

      await this.sendMessage(from, welcomeMsg);
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

    let greeting = `🌿 *¡Hola${partner ? `, ${partner.nombre}` : ''}! Soy Nacho, tu asistente de Natillera Chimba Verde* 🎉\n\n`;

    if (partner) {
      greeting += `Te identifiqué como *${partner.nombre}* 🎰 Rifa #${partner.numeroRifa}\n\n`;
    }

    greeting +=
      `📸 Envía una *foto* de tu comprobante para registrar tu pago\n` +
      `ℹ️ Escribe *INFO* para ver tu información y estado de pago\n`;

    if (await this.isAdmin(from)) {
      greeting +=
        `🧾 Escribe *RECIBO* para ver tu último comprobante\n` +
        `📋 Escribe *COMPROBANTES* para ver todos los comprobantes del mes\n`;
    }

    greeting +=
      `\n━━━━━━━━━━━━━━━━━━\n` +
      `_Solo se aceptan comprobantes de Nequi o Bancolombia._`;

    await this.sendMessage(from, greeting);
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
   * Send the last voucher image to the user via WhatsApp.
   * Looks up the partner's most recent payment that has a voucherImageUrl.
   * If the URL is an R2/public URL, sends it directly via `image.link`.
   */
  private async sendLastVoucherImage(from: string): Promise<void> {
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
        .filter(p => p.voucherImageUrl)
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

      const caption =
        `🧾 *Último comprobante registrado*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 Socio: *${partner.nombre}*\n` +
        `🎰 Rifa: *#${partner.numeroRifa}*\n` +
        `💰 Monto: *$${lastPayment.amount.toLocaleString('es-CO')}*\n` +
        `📅 Mes: *${this.getMonthName(lastPayment.month)} ${lastPayment.periodYear || ''}*\n` +
        `${statusEmoji} Estado: *${statusText}*\n` +
        `━━━━━━━━━━━━━━━━━━`;

      // Try to send the image from the stored URL
      await this.sendImageByUrl(from, lastPayment.voucherImageUrl!, caption);
    } catch (error) {
      this.logger.error('Error sending last voucher image:', error);
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
      }

      const payments = await this.paymentsService.findByMonthAndYear(month, year);
      const withVoucher = payments.filter(p => p.voucherImageUrl);

      if (withVoucher.length === 0) {
        await this.sendMessage(
          from,
          `📋 No se encontraron comprobantes para *${this.getMonthName(month)} ${year}*.\n\n` +
          `_Usa *COMPROBANTES <mes>* (ej: COMPROBANTES 6) para consultar otro mes._`,
        );
        return;
      }

      // Send summary first
      await this.sendMessage(
        from,
        `📋 *Comprobantes de ${this.getMonthName(month)} ${year}*\n\n` +
        `Se encontraron *${withVoucher.length}* comprobante${withVoucher.length === 1 ? '' : 's'}.\n` +
        `Enviando imágenes...`,
      );

      // Send each voucher image (limit to avoid flooding)
      const MAX_IMAGES = 20;
      const toSend = withVoucher.slice(0, MAX_IMAGES);

      for (const payment of toSend) {
        const statusEmoji = payment.status === 'verified' ? '✅' : payment.status === 'pending' ? '⏳' : '❌';
        const statusText = payment.status === 'verified' ? 'Verificado' : payment.status === 'pending' ? 'Pendiente' : 'Rechazado';
        const caption =
          `👤 *${payment.partnerName || 'Socio'}*\n` +
          `💰 $${payment.amount.toLocaleString('es-CO')}\n` +
          `${statusEmoji} ${statusText}`;

        try {
          await this.sendImageByUrl(from, payment.voucherImageUrl!, caption);
          // Small delay between messages to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (imgErr) {
          this.logger.error(`Failed to send voucher image for payment ${payment.id}:`, imgErr);
        }
      }

      if (withVoucher.length > MAX_IMAGES) {
        await this.sendMessage(
          from,
          `⚠️ Se mostraron los primeros ${MAX_IMAGES} de ${withVoucher.length} comprobantes.\nConsulta el panel web para ver todos.`,
        );
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
   * Send an image to a WhatsApp user using a public URL (e.g. from R2).
   * Uses `image.link` instead of `image.id` — no need to upload to WhatsApp first.
   */
  private async sendImageByUrl(to: string, imageUrl: string, caption?: string): Promise<void> {
    try {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      const response = await axios.post(
        `${this.graphApiUrl}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'image',
          image: {
            link: imageUrl,
            ...(caption ? { caption } : {}),
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const waMessageId = response.data?.messages?.[0]?.id || 'unknown';
      this.logger.log(`Image by URL sent to ${to} — WA msg ID: ${waMessageId}`);
    } catch (error: any) {
      const errData = error?.response?.data || error?.message || error;
      this.logger.error(`Error sending image by URL to ${to}:`, JSON.stringify(errData));

      // Fallback: send the URL as a text message
      if (caption) {
        await this.sendMessage(to, `${caption}\n\n📎 ${imageUrl}`);
      }
    }
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
   * Cron: notify unpaid active partners on day 1 and day 5 of each month at 9:00 AM
   */
  @Cron('0 9 1,5 * *')
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
        const hasPaid = payments.some(
          p => p.partnerId === partner.id && (p.status === 'verified' || p.status === 'pending'),
        );

        if (!hasPaid) {
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
   * Notify all admin phones with a voucher image. This method NEVER throws —
   * it catches all errors internally so callers can fire-and-forget.
   * Includes sponsored partner info in the caption automatically.
   */
  private async notifyAdminsVoucher(
    imageId: string,
    partner: any,
    detectedAmount: number,
    parsedVoucher: any,
    paymentMonth: number,
    paymentYear: number,
    captionOverride?: string,
  ): Promise<void> {
    try {
      let caption = captionOverride || '';

      // Try to append sponsored partners info to the caption
      try {
        const allPartners = await this.partnersService.findAll();
        const sponsored = allPartners.filter(p => p.idPartnerPatrocinador === partner.id && p.activo);
        if (sponsored.length > 0) {
          const sponsoredText = `🫂 Patrocinados: ${sponsored.map(p => `*${p.nombre}* (#${p.numeroRifa})`).join(', ')}`;
          // Insert before last ━━ separator if present, else append
          const lastSep = caption.lastIndexOf('━━━━━━━━━━━━━━━━━━');
          if (lastSep > 0) {
            caption = caption.slice(0, lastSep) + sponsoredText + '\n' + caption.slice(lastSep);
          } else {
            caption += '\n' + sponsoredText;
          }
        }
      } catch (partnerErr) {
        this.logger.warn('Could not fetch sponsored partners for admin caption:', partnerErr);
      }

      // Truncate caption to WhatsApp max (1024 chars)
      if (caption.length > 1024) {
        caption = caption.slice(0, 1021) + '...';
        this.logger.warn(`Admin caption truncated to 1024 chars for ${partner.nombre}`);
      }

      // Re-upload the received media so we get a send-ready media ID
      const sendMediaId = await this.reuploadMedia(imageId);
      if (!sendMediaId) {
        this.logger.error(`Could not re-upload media for admin notification (original ID: ${imageId})`);
        return;
      }

      await this.forwardImageToAdmins(sendMediaId, caption);
      this.logger.log(`Admin notification sent for ${partner.nombre} (Rifa #${partner.numeroRifa})`);
    } catch (notifyErr) {
      this.logger.error('Failed to notify admins with voucher image:', notifyErr);
    }
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
   * Get media URL from WhatsApp
   */
  /**
   * Forward an image to a phone number using the WhatsApp media ID
   */
  private async sendImage(to: string, mediaId: string, caption?: string): Promise<void> {
    try {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      const response = await axios.post(
        `${this.graphApiUrl}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'image',
          image: { id: mediaId, ...(caption ? { caption } : {}) },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const waMessageId = response.data?.messages?.[0]?.id || 'unknown';
      this.logger.log(`Image forwarded to ${to} — WA msg ID: ${waMessageId}`);
    } catch (error: any) {
      const errData = error?.response?.data || error?.message || error;
      this.logger.error(`Error forwarding image to ${to}:`, JSON.stringify(errData));
    }
  }

  /**
   * Send a WhatsApp template message with an image header.
   * Templates work outside the 24-hour conversation window.
   * Template "voucher_notification" must exist in Meta Business Manager with:
   *   - Header: IMAGE
   *   - Body:   {{1}}
   */
  private async sendTemplateImage(to: string, mediaId: string, bodyText: string): Promise<void> {
    try {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const templateName = process.env.WHATSAPP_VOUCHER_TEMPLATE || 'voucher_notification';

      // Truncate body param to 1024 chars (WhatsApp template param limit)
      const truncatedBody = bodyText.length > 1024 ? bodyText.slice(0, 1021) + '...' : bodyText;

      const response = await axios.post(
        `${this.graphApiUrl}/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'es_CO' },
            components: [
              {
                type: 'header',
                parameters: [
                  { type: 'image', image: { id: mediaId } },
                ],
              },
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: truncatedBody },
                ],
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const waMessageId = response.data?.messages?.[0]?.id || 'unknown';
      this.logger.log(`Template image sent to ${to} — WA msg ID: ${waMessageId}`);
    } catch (error: any) {
      const errData = error?.response?.data || error?.message || error;
      this.logger.error(`Error sending template image to ${to}:`, JSON.stringify(errData));
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

  /**
   * Forward a WhatsApp-hosted image (by mediaId) to all admin phones.
   * Uses template messages so delivery works outside the 24-hour window.
   */
  async forwardImageToAdmins(mediaId: string, caption?: string): Promise<void> {
    const phones = await this.getAdminPhones();
    if (phones.length === 0) {
      this.logger.warn('No admin users found in the database — skipping forward');
      return;
    }
    const bodyText = caption || 'Nuevo comprobante recibido';
    await Promise.all(phones.map(phone => this.sendTemplateImage(phone, mediaId, bodyText)));
  }

  /**
   * Upload a base64 image to WhatsApp's media API and return the resulting mediaId.
   * Supports data URIs (data:image/jpeg;base64,...) or raw base64 strings.
   * Returns null on failure so callers can gracefully skip forwarding.
   */
  async uploadMediaFromBase64(imageBase64: string): Promise<string | null> {
    try {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      // Strip data URI prefix if present
      const isPng = imageBase64.startsWith('data:image/png');
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      const buffer = Buffer.from(base64Data, 'base64');

      // Build multipart form using native Node 18 globals
      const blob = new Blob([buffer], { type: mimeType });
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mimeType);
      form.append('file', blob, 'voucher.jpg');

      const response = await axios.post(
        `${this.graphApiUrl}/${phoneNumberId}/media`,
        form,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      const mediaId = response.data?.id;
      this.logger.log(`Uploaded media to WhatsApp, mediaId: ${mediaId}`);
      return mediaId || null;
    } catch (error) {
      this.logger.error('Error uploading media to WhatsApp:', error);
      return null;
    }
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
   * Download a received WhatsApp media by its ID and re-upload it to get
   * a media ID that is usable for sending outbound messages.
   * Incoming media IDs are only guaranteed for downloading; to forward
   * to other users we need a freshly uploaded media ID.
   */
  private async reuploadMedia(mediaId: string): Promise<string | null> {
    try {
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

      // Step 1: Get temporary download URL
      const mediaUrl = await this.getMediaUrl(mediaId);
      if (!mediaUrl) {
        this.logger.warn(`reuploadMedia: could not get download URL for ${mediaId}`);
        return null;
      }

      // Step 2: Download the binary image
      const { buffer, mimeType } = await this.downloadMedia(mediaUrl);
      this.logger.log(`reuploadMedia: downloaded ${buffer.length} bytes (${mimeType})`);

      // Step 3: Upload as new media
      const blob = new Blob([buffer], { type: mimeType });
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', mimeType);
      form.append('file', blob, 'voucher.jpg');

      const uploadRes = await axios.post(
        `${this.graphApiUrl}/${phoneNumberId}/media`,
        form,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      const newMediaId = uploadRes.data?.id;
      this.logger.log(`reuploadMedia: ${mediaId} → ${newMediaId}`);
      return newMediaId || null;
    } catch (error: any) {
      const errData = error?.response?.data || error?.message || error;
      this.logger.error('reuploadMedia failed:', JSON.stringify(errData));
      return null;
    }
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
