import { Injectable, Logger } from '@nestjs/common';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { UsersService } from '../../users/application/users.service';
import { OcrService } from './ocr.service';
import { VoucherParserService } from './voucher-parser.service';
import axios from 'axios';

// Pending image session: stored while waiting for raffle number from user
interface PendingSession {
  imageUrl: string;
  messageId: string;
  detectedAmount: number | null;
  parsedVoucher: any;
  from: string;
  timestamp: Date;
}

// Authentication session per phone number
interface AuthSession {
  authenticated: boolean;
  attempts: number;       // failed PIN attempts
  waitingForPin: boolean; // true = bot asked for PIN, waiting response
  expiresAt: Date;        // session expiry (1 hour after last auth)
}

const MAX_PIN_ATTEMPTS = 3;
const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly graphApiUrl = 'https://graph.facebook.com/v18.0';

  // In-memory session store: phone → pending session (waiting for raffle number)
  private readonly pendingSessions = new Map<string, PendingSession>();

  // Auth session store: phone → auth state
  private readonly authSessions = new Map<string, AuthSession>();

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly partnersService: PartnersService,
    private readonly usersService: UsersService,
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
      const messageId = message.id;

      this.logger.log(`Received message from ${from}, type: ${message.type}`);

      // ── Authentication gate ──
      const isAuthenticated = await this.checkOrRequestAuth(message, from);
      if (!isAuthenticated) return;

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

      // Try to extract partner info from caption or contact name
      const raffleNumber = this.extractRaffleNumber(caption);
      const contactName = contact?.profile?.name || caption.trim() || null;

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

      if (partner) {
        await this.registerPaymentForPartner(from, partner, detectedAmount, parsedVoucher, imageUrl, messageId);
      } else {
        // Store pending session and ask for raffle number
        this.pendingSessions.set(from, {
          imageUrl,
          messageId,
          detectedAmount,
          parsedVoucher,
          from,
          timestamp: new Date(),
        });

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
            `Por favor responde con tu *número de rifa* (ej: *#5* o simplemente *5*) ` +
            `para completar el registro.\n\n` +
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
    messageId: string,
  ): Promise<void> {
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

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
      try {
        const validation = this.voucherParserService.validatePaymentVoucher(
          parsedVoucher,
          partner.montoCuota,
          currentMonth,
          currentYear,
        );

        const paymentResult = await this.paymentsService.createFromWhatsAppWithValidation(
          partner.id,
          detectedAmount,
          imageUrl,
          messageId,
          parsedVoucher.type,
          parsedVoucher.date,
          validation.issues,
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
          `📅 Mes: *${this.getMonthName(currentMonth)} ${currentYear}*\n` +
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
            `⚠️ Ya existe un pago registrado para *${partner.nombre}* en *${this.getMonthName(currentMonth)} ${currentYear}*.\n\n` +
              `Si crees que esto es un error, contacta al administrador.`,
          );
        } else {
          await this.sendMessage(
            from,
            `📸 Comprobante recibido, pero ocurrió un error al registrar el pago.\n` +
              `Por favor contacta al administrador.`,
          );
        }
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

    // ── Check if user has a pending session (sent voucher but partner not found) ──
    const session = this.pendingSessions.get(from);
    if (session) {
      // Session expires after 10 minutes
      const sessionAge = (new Date().getTime() - session.timestamp.getTime()) / 1000 / 60;
      if (sessionAge > 10) {
        this.pendingSessions.delete(from);
      } else {
        // User may be providing their raffle number or cancelling
        if (textLower === 'cancelar' || textLower === 'cancel') {
          this.pendingSessions.delete(from);
          await this.sendMessage(from, '✅ Registro cancelado.\n\nEnvía una foto de tu comprobante cuando quieras registrar un pago.');
          return;
        }

        const raffleNumber = this.extractRaffleNumber(text);
        if (raffleNumber !== null) {
          await this.resumeSessionWithRaffle(from, raffleNumber, session);
          return;
        }

        // Might be a number without # prefix
        const directNumber = parseInt(text.replace(/\D/g, ''), 10);
        if (!isNaN(directNumber) && directNumber > 0 && directNumber < 1000) {
          await this.resumeSessionWithRaffle(from, directNumber, session);
          return;
        }

        await this.sendMessage(
          from,
          `⚠️ No entendí ese número de rifa.\n\n` +
          `Por favor responde con tu *número de rifa* (ej: *#5* o simplemente *5*)\n` +
          `o escribe *CANCELAR* para anular el registro.`,
        );
        return;
      }
    }

    // ── Menu commands ──
    const isMenuCommand = ['menu', 'menú', 'hola', 'ayuda', 'help', 'inicio', 'start', '1', '2', '3', 'info', 'información', 'mi rifa'].some(
      (cmd) => textLower === cmd || textLower.startsWith(cmd + ' '),
    );

    if (textLower === '2' || textLower === 'mi info' || textLower === 'mi información' || textLower === 'info') {
      await this.sendPartnerInfo(from);
      return;
    }

    if (isMenuCommand && !['2', 'info', 'información', 'mi rifa'].includes(textLower)) {
      await this.sendWelcomeMenu(from);
      return;
    }

    // ── Amount confirmation (legacy flow) ──
    const amount = this.ocrService.parseColombianCurrency(text);
    if (amount !== null) {
      await this.sendMessage(
        from,
        `✅ Monto confirmado: $${amount.toLocaleString('es-CO')}\n\n` +
          `Ahora envía la foto del comprobante de pago para completar el registro.`,
      );
      return;
    }

    // ── Default: send welcome menu ──
    await this.sendWelcomeMenu(from);
  }

  // ─────────────────── AUTH HELPERS ───────────────────

  /**
   * Main auth gate. Returns true if user is authenticated, false otherwise.
   * If not authenticated, handles the PIN flow automatically.
   */
  private async checkOrRequestAuth(message: any, from: string): Promise<boolean> {
    const session = this.authSessions.get(from);
    const now = new Date();

    // Already authenticated and session not expired
    if (session?.authenticated && session.expiresAt > now) {
      // Refresh expiry on activity
      session.expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
      return true;
    }

    // Session is waiting for PIN and user sent text
    if (session?.waitingForPin && message.type === 'text') {
      const pin = message.text?.body?.trim() ?? '';
      await this.handlePinInput(from, pin, session);
      return false; // Don't process the PIN text as a normal message
    }

    // No session or expired — start auth flow
    if (!session || (!session.waitingForPin && !session.authenticated)) {
      await this.startAuthFlow(from);
      return false;
    }

    // Expired session that was authenticated → ask again
    if (session.authenticated && session.expiresAt <= now) {
      this.authSessions.delete(from);
      await this.startAuthFlow(from);
      return false;
    }

    return false;
  }

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

    // Register session as waiting for PIN
    this.authSessions.set(from, {
      authenticated: false,
      waitingForPin: true,
      attempts: 0,
      expiresAt: new Date(0),
    });

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
      // Success — mark authenticated
      this.authSessions.set(from, {
        authenticated: true,
        waitingForPin: false,
        attempts: 0,
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      });

      const partner = await this.partnersService.findByCelular(normalizedPhone);
      const name = partner?.nombre ?? user.celular;

      await this.sendMessage(
        from,
        `✅ *¡Bienvenido/a, ${name}!* 🎉\n\n` +
        `Soy *Nacho* 🌿 y estoy listo para ayudarte.\n\n` +
        `📸 Envía una foto de tu comprobante para registrar un pago,\n` +
        `o escribe *MENU* para ver todas las opciones.`,
      );
    } else {
      // Failed attempt
      session.attempts += 1;
      this.authSessions.set(from, session);

      const remaining = MAX_ATTEMPTS - session.attempts;

      if (remaining <= 0) {
        // Too many attempts — lock out and reset
        this.authSessions.delete(from);
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
   * Send welcome menu
   */
  private async sendWelcomeMenu(from: string): Promise<void> {
    const normalizedPhone = this.normalizePhone(from);
    const partner = await this.partnersService.findByCelular(normalizedPhone);

    let greeting = `🌿 *¡Hola${partner ? `, ${partner.nombre}` : ''}! Soy Nacho, tu asistente de Natillera Chimba Verde* 🎉\n\n`;

    if (partner) {
      greeting += `Te identifiqué como *${partner.nombre}* 🎰 Rifa #${partner.numeroRifa}\n\n`;
    }

    greeting +=
      `*¿Qué deseas hacer?*\n\n` +
      `📸 *Registrar pago* → Envía una foto de tu comprobante (Nequi o Bancolombia)\n\n` +
      `ℹ️ *Ver mi información* → Responde con *INFO*\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `_Solo se aceptan comprobantes de Nequi o Bancolombia._`;

    await this.sendMessage(from, greeting);
  }

  /**
   * Send partner info card
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
          infoMsg += `\n🤝 *Patrocinador:* ${sponsor.nombre} (Rifa #${sponsor.numeroRifa})\n`;
        }
      } catch (_) { /* sponsor not found */ }
    }

    const currentMonth = this.getMonthName(new Date().getMonth() + 1);
    infoMsg += `\n📅 Mes actual: *${currentMonth} ${new Date().getFullYear()}*\n\n` +
      `📸 Para registrar tu pago, envía una foto de tu comprobante.`;

    await this.sendMessage(from, infoMsg);
  }

  /**
   * Resume a pending session once the raffle number is provided
   */
  private async resumeSessionWithRaffle(from: string, raffleNumber: number, session: PendingSession): Promise<void> {
    this.pendingSessions.delete(from);

    const partner = await this.partnersService.findByNumeroRifa(raffleNumber);

    if (!partner) {
      await this.sendMessage(
        from,
        `❌ No encontré ningún socio con el número de rifa *#${raffleNumber}*.\n\n` +
          `Verifica tu número e intenta de nuevo enviando la imagen del comprobante.\n` +
          `O escribe *MENÚ* para ver las opciones disponibles.`,
      );
      return;
    }

    // Register payment with the found partner
    await this.registerPaymentForPartner(from, partner, session.detectedAmount, session.parsedVoucher, session.imageUrl, session.messageId);
  }

  /**
   * Get media URL from WhatsApp
   */
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
