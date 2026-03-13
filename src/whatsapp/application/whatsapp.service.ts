import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { PartnersService } from '../../partners/application/partners.service';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import { WhatsAppAuthHandler } from './whatsapp-auth.handler';
import { WhatsAppPaymentHandler } from './whatsapp-payment.handler';
import { WhatsAppQueryHandler } from './whatsapp-query.handler';
import {
  AuthSession,
  PendingSponsorChoice,
  PendingMonthChoice,
  PendingIntegrationChoice,
  PendingSession,
  AdminPaySession,
  KEY_WA_AUTH,
  KEY_WA_PENDING,
  KEY_WA_SPONSOR,
  KEY_WA_MONTH_CHOICE,
  KEY_WA_VOUCHER_MONTH,
  KEY_WA_ADMIN_PAY,
  KEY_WA_INTEGRATION_CHOICE,
  AUTH_SESSION_TTL,
  PENDING_SESSION_TTL,
} from './whatsapp.types';
import { normalizePhone, extractRaffleNumber } from './whatsapp.utils';

/**
 * Main WhatsApp service — slim orchestrator.
 * Routes incoming webhook messages to the appropriate handler.
 * Delegates all domain logic to dedicated handler services.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly partnersService: PartnersService,
    private readonly messagingService: WhatsAppMessagingService,
    private readonly authHandler: WhatsAppAuthHandler,
    private readonly paymentHandler: WhatsAppPaymentHandler,
    private readonly queryHandler: WhatsAppQueryHandler,
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
      const from = message.from;

      this.logger.log(`Received message from ${from}, type: ${message.type}`);

      // Handle image messages (payment vouchers)
      if (message.type === 'image') {
        await this.paymentHandler.handleImageMessage(message, from, contact);
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
   * Send WhatsApp message — public proxy for backward compatibility.
   * External services (RafflesService, etc.) call this method.
   */
  async sendMessage(to: string, text: string): Promise<void> {
    return this.messagingService.sendMessage(to, text);
  }

  // ─────────────────── TEXT MESSAGE ROUTER ───────────────────

  /**
   * Handle text message — routes to the appropriate handler based on
   * active Redis sessions and command keywords.
   */
  private async handleTextMessage(message: any, from: string): Promise<void> {
    const text = (message.text?.body || '').trim();
    const textLower = text.toLowerCase();

    this.logger.log(`Text message from ${from}: ${text}`);

    // ── If the user is mid-PIN-flow, collect their PIN first ──
    const authSession = await this.redisService.get<AuthSession>(KEY_WA_AUTH + from);
    if (authSession?.waitingForPin) {
      await this.authHandler.handlePinInput(from, text, authSession);
      return;
    }

    // ── Pending sponsor choice (waiting for SÍ/NO or partner number) ──
    const sponsorChoice = await this.redisService.get<PendingSponsorChoice>(KEY_WA_SPONSOR + from);
    if (sponsorChoice) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_SPONSOR + from);
        await this.messagingService.sendMessage(from, '✅ Registro cancelado.\n\nEnvía una foto de tu comprobante cuando quieras registrar un pago.');
        return;
      }
      await this.paymentHandler.handleSponsorChoice(from, text, sponsorChoice);
      return;
    }

    // ── Pending integration choice (quota vs integration payment) ──
    const integrationChoice = await this.redisService.get<PendingIntegrationChoice>(KEY_WA_INTEGRATION_CHOICE + from);
    if (integrationChoice) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_INTEGRATION_CHOICE + from);
        await this.messagingService.sendMessage(from, '✅ Registro cancelado.\n\nEnvía una foto de tu comprobante cuando quieras registrar un pago.');
        return;
      }
      await this.paymentHandler.handleIntegrationChoice(from, text, integrationChoice);
      return;
    }

    // ── Pending month choice (day 6-14 ambiguous billing period) ──
    const monthChoice = await this.redisService.get<PendingMonthChoice>(KEY_WA_MONTH_CHOICE + from);
    if (monthChoice) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_MONTH_CHOICE + from);
        await this.messagingService.sendMessage(from, '✅ Registro cancelado.\n\nEnvía una foto de tu comprobante cuando quieras registrar un pago.');
        return;
      }
      await this.paymentHandler.handleMonthChoice(from, text, monthChoice);
      return;
    }

    // ── Pending voucher month query (admin waiting for month number for COMPROBANTES) ──
    const voucherMonthQuery = await this.redisService.get<{ active: boolean }>(KEY_WA_VOUCHER_MONTH + from);
    if (voucherMonthQuery) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_VOUCHER_MONTH + from);
        await this.messagingService.sendMessage(from, '✅ Consulta cancelada.');
        return;
      }
      const monthNum = parseInt(text.trim(), 10);
      if (monthNum >= 1 && monthNum <= 12) {
        await this.redisService.del(KEY_WA_VOUCHER_MONTH + from);
        await this.queryHandler.sendMonthlyVouchers(from, `COMPROBANTES ${monthNum}`);
        return;
      }
      await this.messagingService.sendMessage(from, '⚠️ Por favor ingresa un número de mes válido (1-12).\n\n_Escribe CANCELAR para anular._');
      return;
    }

    // ── Admin pay-for-others: partner selection step or awaiting image ──
    const adminPaySession = await this.redisService.get<AdminPaySession>(KEY_WA_ADMIN_PAY + from);
    if (adminPaySession) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_ADMIN_PAY + from);
        await this.messagingService.sendMessage(from, '✅ Registro cancelado.');
        return;
      }
      if (adminPaySession.step === 'select_partner') {
        await this.paymentHandler.handleAdminPartnerSelection(from, text, adminPaySession);
        return;
      }
      if (adminPaySession.step === 'awaiting_image') {
        await this.messagingService.sendMessage(from,
          `📸 Estoy esperando la *foto del comprobante* para *${adminPaySession.selectedPartnerName}*.\n\n` +
          `Envía la imagen o escribe *CANCELAR* para anular.`,
        );
        return;
      }
    }

    // ── Pending voucher session (partner not found, waiting for raffle number) ──
    const pendingSession = await this.redisService.get<PendingSession>(KEY_WA_PENDING + from);
    if (pendingSession) {
      if (textLower === 'cancelar' || textLower === 'cancel') {
        await this.redisService.del(KEY_WA_PENDING + from);
        await this.messagingService.sendMessage(from, '✅ Registro cancelado.\n\nEnvía una foto de tu comprobante cuando quieras registrar un pago.');
        return;
      }

      const raffleNumber = extractRaffleNumber(text);
      if (raffleNumber !== null) {
        await this.paymentHandler.resumeSessionWithRaffle(from, raffleNumber, pendingSession);
        return;
      }

      // 10-digit number → treat as cellphone lookup
      const digits = text.replace(/\D/g, '');
      if (digits.length === 10) {
        await this.paymentHandler.resumeSessionWithCelular(from, digits, pendingSession);
        return;
      }

      // Plain short number (1–3 digits) without # prefix → raffle number
      const directNumber = parseInt(digits, 10);
      if (!isNaN(directNumber) && directNumber > 0 && directNumber < 1000) {
        await this.paymentHandler.resumeSessionWithRaffle(from, directNumber, pendingSession);
        return;
      }

      await this.messagingService.sendMessage(
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
        const isAdminUser = await this.messagingService.isAdmin(from);
        await this.redisService.set(KEY_WA_AUTH + from, {
          ...authSession,
          menuActive: true,
        }, AUTH_SESSION_TTL);
        const phone = normalizePhone(from);
        const partner = await this.partnersService.findByCelular(phone);
        await this.authHandler.sendNumberedMenu(from, partner?.nombre ?? 'Socio', isAdminUser);
      } else {
        await this.authHandler.startAuthFlow(from, 'menu');
      }
      return;
    }

    // ── Numbered menu selection (1, 2, 3, 4) when menu is active ──
    if (authSession?.authenticated && authSession?.menuActive && /^[1-4]$/.test(text.trim())) {
      await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
      // Clear menuActive flag
      await this.redisService.set(KEY_WA_AUTH + from, {
        ...authSession,
        menuActive: false,
      }, AUTH_SESSION_TTL);

      const option = parseInt(text.trim(), 10);
      if (option === 1) {
        await this.queryHandler.sendPartnerInfoWithVoucher(from);
      } else if (option === 2) {
        await this.queryHandler.sendLastRaffleWinner(from);
      } else if (option === 3) {
        if (await this.messagingService.isAdmin(from)) {
          await this.queryHandler.sendMonthlyVouchers(from, 'COMPROBANTES');
        } else {
          await this.messagingService.sendMessage(from, `⚠️ Esta opción está disponible solo para administradores.`);
        }
      } else if (option === 4) {
        if (await this.messagingService.isAdmin(from)) {
          await this.paymentHandler.startAdminPayForPartner(from);
        } else {
          await this.messagingService.sendMessage(from, `⚠️ Esta opción está disponible solo para administradores.`);
        }
      }
      return;
    }

    // ── INFO command — requires PIN authentication ──
    if (textLower === 'info' || textLower === 'mi info' || textLower === 'mi información' || textLower === 'información') {
      if (authSession?.authenticated) {
        await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
        await this.queryHandler.sendPartnerInfo(from);
      } else {
        await this.authHandler.startAuthFlow(from);
      }
      return;
    }

    // ── RECIBO command — send last voucher presigned URL (requires PIN authentication) ──
    if (textLower === 'recibo' || textLower === 'comprobante' || textLower === 'mi recibo' || textLower === 'mi comprobante') {
      if (authSession?.authenticated) {
        await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
        await this.queryHandler.sendLastVoucherUrl(from);
      } else {
        await this.authHandler.startAuthFlow(from);
      }
      return;
    }

    // ── COMPROBANTES command — admin queries all vouchers for a month ──
    if (textLower.startsWith('comprobantes')) {
      if (authSession?.authenticated) {
        await this.redisService.expire(KEY_WA_AUTH + from, AUTH_SESSION_TTL);
        if (await this.messagingService.isAdmin(from)) {
          await this.queryHandler.sendMonthlyVouchers(from, text);
        } else {
          await this.messagingService.sendMessage(from, `⚠️ Este comando está disponible solo para administradores.`);
        }
      } else {
        await this.authHandler.startAuthFlow(from);
      }
      return;
    }

    // ── Default: guide user ──
    await this.messagingService.sendMessage(
      from,
      `🌿 *Hola, soy Nacho*\n\n` +
      `Puedes:\n` +
      `📸 Enviar una *foto* de tu comprobante (Nequi o Bancolombia) para registrar tu pago\n` +
      `ℹ️ Escribir *MENU* para ver más opciones\n\n` +
      `_(Requiere PIN) · Solo se aceptan comprobantes de Nequi o Bancolombia._`,
    );
  }
}
