import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../../users/application/users.service';
import { PartnersService } from '../../partners/application/partners.service';
import { RedisService } from '../../redis/redis.service';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import {
  AuthSession,
  KEY_WA_AUTH,
  AUTH_SESSION_TTL,
  PENDING_SESSION_TTL,
  MAX_PIN_ATTEMPTS,
} from './whatsapp.types';
import { normalizePhone } from './whatsapp.utils';

/**
 * Handles PIN-based authentication flow for WhatsApp users.
 */
@Injectable()
export class WhatsAppAuthHandler {
  private readonly logger = new Logger(WhatsAppAuthHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly partnersService: PartnersService,
    private readonly redisService: RedisService,
    private readonly messagingService: WhatsAppMessagingService,
  ) {}

  /**
   * Start the PIN authentication flow: look up user, send PIN request.
   */
  async startAuthFlow(from: string, pendingCommand?: string): Promise<void> {
    const phone = normalizePhone(from);

    // Check if phone is registered as a user
    const user = await this.usersService.findByCelular(phone);

    if (!user) {
      await this.messagingService.sendMessage(
        from,
        `🌿 *¡Hola! Soy Nacho, tu asistente de Natillera Chimba Verde!* 👋\n\n` +
        `Tu número no está registrado en el sistema todavía. 😅\n\n` +
        `Habla con el administrador para que te registre y puedas disfrutar de todos los beneficios. 🎉`,
      );
      return;
    }

    if (!user.activo) {
      await this.messagingService.sendMessage(
        from,
        `⛔ *¡Ups! Tu cuenta está desactivada.*\n\n` +
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

    await this.messagingService.sendMessage(
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
  async handlePinInput(from: string, pin: string, session: AuthSession): Promise<void> {
    const phone = normalizePhone(from);

    // Validate PIN via UsersService (checks activo + bcrypt compare)
    const user = await this.usersService.validateUser(phone, pin);

    if (user) {
      // Success — store authenticated session in Redis with 1-hour TTL
      const isAdminUser = await this.messagingService.isAdmin(from);
      const pendingCmd = session.pendingCommand;

      await this.redisService.set(KEY_WA_AUTH + from, {
        authenticated: true,
        waitingForPin: false,
        attempts: 0,
        menuActive: pendingCmd === 'menu',
      }, AUTH_SESSION_TTL);

      const partner = await this.partnersService.findByCelular(phone);
      const name = partner?.nombre ?? user.celular;

      if (pendingCmd === 'menu') {
        // Show numbered menu right after successful PIN
        await this.sendNumberedMenu(from, name, isAdminUser);
      } else {
        const welcomeMsg =
          `✅ *¡Bienvenido/a, ${name}!* 🎉\n\n` +
          `Soy *Nacho* 🌿 y estoy listo para ayudarte.\n\n` +
          `📸 Envía una foto de tu comprobante para registrar un pago\n` +
          `ℹ️ Escribe *MENU* para ver más opciones`;

        await this.messagingService.sendMessage(from, welcomeMsg);
      }
    } else {
      // Failed attempt
      session.attempts += 1;
      await this.redisService.set(KEY_WA_AUTH + from, session, PENDING_SESSION_TTL);

      const remaining = MAX_PIN_ATTEMPTS - session.attempts;

      if (remaining <= 0) {
        // Too many attempts — delete session (lock out)
        await this.redisService.del(KEY_WA_AUTH + from);
        await this.messagingService.sendMessage(
          from,
          `⛔ *¡Ay, demasiados intentos fallidos!*\n\n` +
          `Soy Nacho 🌿 y por tu seguridad he bloqueado el acceso temporalmente.\n\n` +
          `Contacta al administrador si olvidaste tu PIN.`,
        );
      } else {
        await this.messagingService.sendMessage(
          from,
          `❌ *PIN incorrecto, ¡inténtalo de nuevo!*\n\n` +
          `Te quedan *${remaining}* intento${remaining === 1 ? '' : 's'}. 🤞\n\n` +
          `Ingresa tu PIN de 4 dígitos:`,
        );
      }
    }
  }

  /**
   * Send the numbered menu. Options vary by role.
   */
  async sendNumberedMenu(from: string, name: string, isAdmin: boolean): Promise<void> {
    let menuMsg =
      `📋 *Menú de opciones — ${name}*\n\n` +
      `1️⃣ Mi información, estado de pago y comprobante\n` +
      `2️⃣ Ganador de la última rifa\n`;

    if (isAdmin) {
      menuMsg += `3️⃣ Ver todos los comprobantes del mes\n`;
      menuMsg += `4️⃣ Registrar pago de un socio\n`;
    }

    menuMsg += `\n_Responde con el *número* de la opción._`;

    await this.messagingService.sendMessage(from, menuMsg);
  }
}
