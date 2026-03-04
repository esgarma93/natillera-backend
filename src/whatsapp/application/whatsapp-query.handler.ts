import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { RafflesService } from '../../raffles/application/raffles.service';
import { StorageService } from '../../storage/storage.service';
import { RedisService } from '../../redis/redis.service';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import {
  KEY_WA_VOUCHER_MONTH,
  PENDING_SESSION_TTL,
} from './whatsapp.types';
import {
  normalizePhone,
  getMonthName,
  getLastFridayOfMonth,
  buildVoucherRedirectUrl,
} from './whatsapp.utils';

/**
 * Handles information/query commands: partner info, raffle winner,
 * voucher URLs, monthly comprobantes summary, and menus.
 */
@Injectable()
export class WhatsAppQueryHandler {
  private readonly logger = new Logger(WhatsAppQueryHandler.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly partnersService: PartnersService,
    @Inject(forwardRef(() => RafflesService))
    private readonly rafflesService: RafflesService,
    private readonly storageService: StorageService,
    private readonly redisService: RedisService,
    private readonly messagingService: WhatsAppMessagingService,
  ) {}

  /**
   * Send partner info card with payment status and next raffle date
   */
  async sendPartnerInfo(from: string): Promise<void> {
    const normalizedPhone = normalizePhone(from);
    const partner = await this.partnersService.findByCelular(normalizedPhone);

    if (!partner) {
      await this.messagingService.sendMessage(
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
    const nextRaffleDate = getLastFridayOfMonth(currentMonth, currentYear);
    const nextRaffleDateStr = `${nextRaffleDate.getDate()} de ${getMonthName(currentMonth)} de ${currentYear}`;

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
      `📅 *Mes actual:* ${getMonthName(currentMonth)} ${currentYear}\n` +
      `💳 *Estado de pago:* ${paymentStatus}\n` +
      `🎲 *Próxima rifa:* ${nextRaffleDateStr}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n`;

    // Payment deadline = 5th of next month
    const deadlineMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const deadlineYear = currentMonth === 12 ? currentYear + 1 : currentYear;
    const deadlineDateStr = `5 de ${getMonthName(deadlineMonth)} de ${deadlineYear}`;

    if (!currentMonthPayment) {
      infoMsg += `📸 Recuerda enviar tu comprobante antes del *${deadlineDateStr}* para participar en la rifa.`;
    } else {
      infoMsg += `📸 Para registrar un pago envía una foto de tu comprobante (Nequi o Bancolombia).`;
    }

    await this.messagingService.sendMessage(from, infoMsg);
  }

  /**
   * Combined option: send partner info + payment status + last voucher in a single flow.
   */
  async sendPartnerInfoWithVoucher(from: string): Promise<void> {
    const normalizedPhone = normalizePhone(from);
    const partner = await this.partnersService.findByCelular(normalizedPhone);

    if (!partner) {
      await this.messagingService.sendMessage(
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
    const nextRaffleDate = getLastFridayOfMonth(currentMonth, currentYear);
    const nextRaffleDateStr = `${nextRaffleDate.getDate()} de ${getMonthName(currentMonth)} de ${currentYear}`;

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
      `📅 *${getMonthName(currentMonth)} ${currentYear}*\n` +
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
        const voucherUrl = buildVoucherRedirectUrl(last.id);

        msg +=
          `🧾 *Último comprobante*\n` +
          `💰 $${last.amount.toLocaleString('es-CO')} — ${getMonthName(last.month)} ${last.periodYear || ''}\n` +
          `${statusEmoji} ${statusText}\n` +
          `🔗 ${voucherUrl}\n`;
      } else {
        msg += `📋 _No tienes comprobantes registrados aún._\n`;
        msg += `📸 Envía una foto de tu comprobante para registrar tu primer pago.\n`;
      }
    } catch (err) {
      this.logger.error('Error fetching voucher in combined info:', err);
    }

    await this.messagingService.sendMessage(from, msg);
  }

  /**
   * Send the last (most recent) raffle result to the user.
   */
  async sendLastRaffleWinner(from: string): Promise<void> {
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
        await this.messagingService.sendMessage(
          from,
          `🎰 *Última rifa*\n\n` +
          `No se ha realizado ningún sorteo recientemente.\n\n` +
          `_El sorteo se realiza el sábado después del último viernes de cada mes._`,
        );
        return;
      }

      const monthName = raffle.monthName || getMonthName(raffle.month);

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

      await this.messagingService.sendMessage(from, msg);
    } catch (error) {
      this.logger.error('Error sending last raffle winner:', error);
      await this.messagingService.sendMessage(
        from,
        `❌ Ocurrió un error al consultar la rifa.\nPor favor intenta de nuevo.`,
      );
    }
  }

  /**
   * Send the last voucher image to the user via WhatsApp.
   */
  async sendLastVoucherUrl(from: string): Promise<void> {
    const normalizedPhone = normalizePhone(from);
    const partner = await this.partnersService.findByCelular(normalizedPhone);

    if (!partner) {
      await this.messagingService.sendMessage(
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
        await this.messagingService.sendMessage(
          from,
          `📋 No encontré comprobantes registrados para *${partner.nombre}*.\n\n` +
            `📸 Envía una foto de tu comprobante para registrar tu primer pago.`,
        );
        return;
      }

      const lastPayment = withVoucher[0];
      const statusEmoji = lastPayment.status === 'verified' ? '✅' : lastPayment.status === 'pending' ? '⏳' : '❌';
      const statusText = lastPayment.status === 'verified' ? 'Verificado' : lastPayment.status === 'pending' ? 'Pendiente' : 'Rechazado';

      const voucherUrl = buildVoucherRedirectUrl(lastPayment.id);

      const msg =
        `🧾 *Último comprobante registrado*\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 Socio: *${partner.nombre}*\n` +
        `🎰 Rifa: *#${partner.numeroRifa}*\n` +
        `💰 Monto: *$${lastPayment.amount.toLocaleString('es-CO')}*\n` +
        `📅 Mes: *${getMonthName(lastPayment.month)} ${lastPayment.periodYear || ''}*\n` +
        `${statusEmoji} Estado: *${statusText}*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `🔗 *Ver comprobante:*\n${voucherUrl}`;

      await this.messagingService.sendMessage(from, msg);
    } catch (error) {
      this.logger.error('Error sending last voucher URL:', error);
      await this.messagingService.sendMessage(
        from,
        `❌ Ocurrió un error al recuperar tu comprobante.\nPor favor intenta de nuevo.`,
      );
    }
  }

  /**
   * Admin command: send all voucher images for a given month.
   * Usage: COMPROBANTES (current month) or COMPROBANTES <month_number>
   */
  async sendMonthlyVouchers(from: string, rawText: string): Promise<void> {
    try {
      // Parse optional month number from text
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
        await this.messagingService.sendMessage(from,
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

      // ── Build payment summary ──
      const allPartners = await this.partnersService.findAll();
      const activePartners = allPartners.filter(p => p.activo);
      const monthName = getMonthName(month);

      // Determine which active partners have paid (any status except rejected)
      const paidPartnerIds = new Set(
        payments
          .filter(p => p.status === 'verified' || p.status === 'pending')
          .map(p => p.partnerId),
      );
      const unpaidPartners = activePartners.filter(p => !paidPartnerIds.has(p.id));

      // Financial totals
      const totalExpected = activePartners.reduce((sum, p) => sum + (p.montoCuota || 0), 0);
      const totalReceived = payments
        .filter(p => p.status === 'verified' || p.status === 'pending')
        .reduce((sum, p) => sum + p.amount, 0);
      const difference = totalReceived - totalExpected;

      // Verified vs pending counts
      const verifiedCount = payments.filter(p => p.status === 'verified').length;
      const pendingCount = payments.filter(p => p.status === 'pending').length;

      if (withVoucher.length === 0 && payments.length === 0) {
        await this.messagingService.sendMessage(
          from,
          `📋 No se encontraron comprobantes para *${monthName} ${year}*.\n\n` +
          `👥 Socios activos: *${activePartners.length}* — Ninguno ha pagado aún.\n` +
          `💰 Esperado: *$${totalExpected.toLocaleString('es-CO')}*\n\n` +
          `_Usa *COMPROBANTES <mes>* (ej: COMPROBANTES 6) para consultar otro mes._`,
        );
        return;
      }

      // ── Summary header ──
      let summaryEmoji: string;
      let summaryText: string;
      if (unpaidPartners.length === 0 && difference === 0) {
        summaryEmoji = '✅';
        summaryText = '¡Todo cuadra! Todos los socios pagaron y los montos coinciden.';
      } else if (unpaidPartners.length === 0 && difference > 0) {
        summaryEmoji = '📈';
        summaryText = `Todos pagaron. Hay un *sobrante* de *$${difference.toLocaleString('es-CO')}*.`;
      } else if (unpaidPartners.length === 0 && difference < 0) {
        summaryEmoji = '⚠️';
        summaryText = `Todos pagaron pero hay un *faltante* de *$${Math.abs(difference).toLocaleString('es-CO')}*.`;
      } else if (difference >= 0) {
        summaryEmoji = '⏳';
        summaryText = `Faltan *${unpaidPartners.length}* socio${unpaidPartners.length !== 1 ? 's' : ''} por pagar.`;
      } else {
        summaryEmoji = '⚠️';
        summaryText = `Faltan *${unpaidPartners.length}* socio${unpaidPartners.length !== 1 ? 's' : ''} por pagar y hay un *faltante* de *$${Math.abs(difference).toLocaleString('es-CO')}*.`;
      }

      let msg =
        `📋 *Comprobantes de ${monthName} ${year}*\n\n` +
        `${summaryEmoji} ${summaryText}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👥 Socios activos: *${activePartners.length}*\n` +
        `💵 Pagaron: *${paidPartnerIds.size}* (✅ ${verifiedCount} verificado${verifiedCount !== 1 ? 's' : ''} · ⏳ ${pendingCount} pendiente${pendingCount !== 1 ? 's' : ''})\n` +
        `💰 Esperado: *$${totalExpected.toLocaleString('es-CO')}*\n` +
        `💰 Recibido: *$${totalReceived.toLocaleString('es-CO')}*\n` +
        (difference !== 0
          ? `${difference > 0 ? '📈' : '📉'} Diferencia: *${difference > 0 ? '+' : '-'}$${Math.abs(difference).toLocaleString('es-CO')}*\n`
          : '') +
        (unpaidPartners.length > 0
          ? `❌ Sin pagar: ${unpaidPartners.map(p => p.nombre).join(', ')}\n`
          : '') +
        `━━━━━━━━━━━━━━━━━━\n\n`;

      // ── Individual vouchers ──
      if (withVoucher.length > 0) {
        msg += `📎 *${withVoucher.length}* comprobante${withVoucher.length === 1 ? '' : 's'}:\n\n`;

        for (const payment of withVoucher) {
          const statusEmoji = payment.status === 'verified' ? '✅' : payment.status === 'pending' ? '⏳' : '❌';
          const voucherUrl = buildVoucherRedirectUrl(payment.id);

          msg += `${statusEmoji} *${payment.partnerName || 'Socio'}* — $${payment.amount.toLocaleString('es-CO')}\n`;
          msg += `🔗 ${voucherUrl}\n\n`;
        }
      }

      msg += `━━━━━━━━━━━━━━━━━━`;

      // WhatsApp max message length is ~65536 chars; split if needed
      if (msg.length > 4096) {
        const lines = msg.split('\n');
        let chunk = '';
        for (const line of lines) {
          if ((chunk + '\n' + line).length > 4000 && chunk.length > 0) {
            await this.messagingService.sendMessage(from, chunk);
            chunk = line;
          } else {
            chunk = chunk ? chunk + '\n' + line : line;
          }
        }
        if (chunk) await this.messagingService.sendMessage(from, chunk);
      } else {
        await this.messagingService.sendMessage(from, msg);
      }
    } catch (error) {
      this.logger.error('Error sending monthly vouchers:', error);
      await this.messagingService.sendMessage(
        from,
        `❌ Ocurrió un error al consultar los comprobantes.\nPor favor intenta de nuevo.`,
      );
    }
  }
}
