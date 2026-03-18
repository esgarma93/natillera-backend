import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { IntegrationsService } from '../../integrations/application/integrations.service';
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
    private readonly messagingService: WhatsAppMessagingService,
  ) {}

  /**
   * Cron: notify unpaid active partners on day 5 of each month at 9:00 AM.
   * Only notifies partners who have NOT paid for the current month.
   */
  @Cron('0 9 5 * *')
  async notifyUnpaidPartners(): Promise<void> {
    const now = toColombiaDate(new Date());
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthName = getMonthName(month);
    const nextRaffleDate = getLastFridayOfMonth(month, year);
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
}
