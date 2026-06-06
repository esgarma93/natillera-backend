import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { IntegrationsService } from '../../integrations/application/integrations.service';
import { PollaService } from '../../polla/application/polla.service';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import { getMonthName, getLastFridayOfMonth, toColombiaDate } from './whatsapp.utils';

/**
 * Handles scheduled (cron) WhatsApp notifications.
 */
@Injectable()
export class WhatsAppCronHandler {
  private readonly logger = new Logger(WhatsAppCronHandler.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly partnersService: PartnersService,
    private readonly integrationsService: IntegrationsService,
    private readonly pollaService: PollaService,
    private readonly messagingService: WhatsAppMessagingService,
  ) {}

  /**
   * Cron: notify unpaid active partners on day 5 of each month at 9:00 AM.
   * Day 5 is the deadline for the PREVIOUS month's quota (e.g. on June 5 the
   * payment due is for May), so the reminder targets the previous month.
   * Only notifies partners who have NOT paid for that month.
   */
  @Cron('0 9 5 * *')
  async notifyUnpaidPartners(): Promise<void> {
    const now = toColombiaDate(new Date());
    const calendarMonth = now.getMonth() + 1;
    const calendarYear = now.getFullYear();
    // Day 5 is the deadline for the previous month's quota.
    const month = calendarMonth === 1 ? 12 : calendarMonth - 1;
    const year = calendarMonth === 1 ? calendarYear - 1 : calendarYear;
    const monthName = getMonthName(month);
    // The raffle a partner qualifies for by paying is this calendar month's one.
    const nextRaffleDate = getLastFridayOfMonth(calendarMonth, calendarYear);
    const nextRaffleDateStr = `${nextRaffleDate.getDate()} de ${getMonthName(calendarMonth)} de ${calendarYear}`;

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
            await this.messagingService.sendMessage(
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
   * Cron: every day at 9:00 AM, check for integrations happening in 3 days
   * and send a WhatsApp reminder to all active partners.
   */
  @Cron('0 9 * * *')
  async notifyUpcomingIntegrations(): Promise<void> {
    const now = toColombiaDate(new Date());
    const year = now.getFullYear();

    this.logger.log('Running integration reminder cron...');

    try {
      const integrations = await this.integrationsService.findByYear(year);
      const upcomingIn3Days = integrations.filter((integ) => {
        if (integ.status !== 'upcoming' && integ.status !== 'active') return false;
        const integDate = toColombiaDate(new Date(integ.date));
        const diffMs = integDate.getTime() - now.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        return diffDays === 3;
      });

      if (upcomingIn3Days.length === 0) {
        this.logger.log('No integrations in 3 days, skipping.');
        return;
      }

      const partners = await this.partnersService.findAll();
      const activePartners = partners.filter(p => p.activo && p.celular);

      let totalNotified = 0;
      for (const integ of upcomingIn3Days) {
        const integDate = new Date(integ.date);
        const dateStr = integDate.toLocaleDateString('es-CO', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'America/Bogota',
        });

        for (const partner of activePartners) {
          const whatsappNumber = `57${partner.celular!.replace(/\D/g, '')}`;
          try {
            await this.messagingService.sendMessage(
              whatsappNumber,
              `🎉 *Recordatorio de Integración*\n\n` +
              `Hola *${partner.nombre}* 👋\n\n` +
              `Soy Nacho 🌿 y te recuerdo que en *3 días* tenemos integración:\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `📌 *${integ.name}*\n` +
              `📅 Fecha: *${dateStr}*\n` +
              `🏠 Anfitrión: *${integ.hostPartnerName}*\n` +
              `💵 Costo: *$${integ.totalCostPerPerson.toLocaleString('es-CO')}*\n` +
              `━━━━━━━━━━━━━━━━━━\n\n` +
              `📸 Envíame tu comprobante de pago para quedar registrado. ¡No faltes! 🥳`,
            );
            totalNotified++;
          } catch (err) {
            this.logger.error(`Failed to send integration reminder to ${partner.nombre}:`, err);
          }
        }
      }

      this.logger.log(`Integration reminders sent: ${totalNotified} messages for ${upcomingIn3Days.length} integration(s)`);
    } catch (error) {
      this.logger.error('Error running integration reminder cron:', error);
    }
  }

  /**
   * Cron: every day at 10:00 AM Colombia time, remind active partners who still
   * have NOT registered a prediction for matches kicking off in ~48h (window
   * [now+24h, now+48h)). The 24h-wide window run once daily guarantees each
   * match is notified on exactly one day, avoiding duplicate alerts.
   */
  @Cron('0 10 * * *', { timeZone: 'America/Bogota' })
  async notifyMissingPollaPredictions(): Promise<void> {
    this.logger.log('Running polla 48h prediction reminder cron...');

    try {
      const reminders = await this.pollaService.getMissingPredictionReminders(new Date());
      if (reminders.length === 0) {
        this.logger.log('No partners missing predictions in the 48h window, skipping.');
        return;
      }

      let notified = 0;
      for (const reminder of reminders) {
        const whatsappNumber = `57${reminder.celular.replace(/\D/g, '')}`;
        const matchLines = reminder.matches
          .map((m) => {
            const dateStr = new Date(m.date).toLocaleString('es-CO', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Bogota',
            });
            return `⚽ *${m.homeTeam}* vs *${m.awayTeam}*\n   🗓️ ${dateStr}`;
          })
          .join('\n');

        try {
          await this.messagingService.sendMessage(
            whatsappNumber,
            `⏰ *Polla Mundial 2026 - ¡Faltan tus predicciones!*\n\n` +
            `Hola *${reminder.partnerName}* 👋\n\n` +
            `Soy Nacho 🌿. En menos de *48 horas* se juega(n) ${reminder.matches.length === 1 ? 'este partido' : 'estos partidos'} y aún no registras tu predicción:\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `${matchLines}\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `📲 Entra a la app y registra tu marcador antes de que cierre (24h antes del partido). ¡No te quedes sin puntos! 🏆`,
          );
          notified++;
        } catch (err) {
          this.logger.error(`Failed to send polla reminder to ${reminder.partnerName} (${whatsappNumber}):`, err);
        }
      }

      this.logger.log(`Polla prediction reminders sent: ${notified} of ${reminders.length} partners`);
    } catch (error) {
      this.logger.error('Error running polla prediction reminder cron:', error);
    }
  }
}
