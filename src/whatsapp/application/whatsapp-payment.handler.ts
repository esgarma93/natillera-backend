import { Injectable, Logger } from '@nestjs/common';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../../storage/storage.service';
import { OcrService } from './ocr.service';
import { VoucherParserService } from './voucher-parser.service';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import {
  PendingSession,
  PendingSponsorChoice,
  PendingMonthChoice,
  AdminPaySession,
  KEY_WA_PENDING,
  KEY_WA_SPONSOR,
  KEY_WA_MONTH_CHOICE,
  KEY_WA_ADMIN_PAY,
  PENDING_SESSION_TTL,
} from './whatsapp.types';
import {
  normalizePhone,
  extractRaffleNumber,
  getMonthName,
  determineBillingPeriod,
  buildVoucherRedirectUrl,
} from './whatsapp.utils';

/**
 * Handles payment processing: image reception, voucher OCR, payment creation,
 * sponsor choice, month choice, and admin pay-for-others flow.
 */
@Injectable()
export class WhatsAppPaymentHandler {
  private readonly logger = new Logger(WhatsAppPaymentHandler.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly partnersService: PartnersService,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
    private readonly ocrService: OcrService,
    private readonly voucherParserService: VoucherParserService,
    private readonly messagingService: WhatsAppMessagingService,
  ) {}

  /**
   * Handle image message (payment voucher)
   */
  async handleImageMessage(message: any, from: string, contact: any): Promise<void> {
    const imageId = message.image?.id;
    const caption = message.image?.caption || '';
    const messageId = message.id;

    this.logger.log(`Processing image message. ID: ${imageId}, Caption: ${caption}`);

    try {
      // Get image URL from WhatsApp
      const imageUrl = await this.messagingService.getMediaUrl(imageId);

      if (!imageUrl) {
        await this.messagingService.sendMessage(from, '❌ No se pudo procesar la imagen. Por favor intente de nuevo.');
        return;
      }

      // Download image binary for OCR + cloud storage
      const { buffer: imageBuffer, mimeType: imageMimeType } = await this.messagingService.downloadMedia(imageUrl);

      // Try to extract text using OCR and parse voucher
      const ocrResult = await this.ocrService.extractAmountFromImage(imageUrl);
      const parsedVoucher = this.voucherParserService.parseVoucher(ocrResult.rawText || '');

      this.logger.log(`Parsed voucher: type=${parsedVoucher.type}, amount=${parsedVoucher.amount}, confidence=${parsedVoucher.confidence}`);

      // Check if voucher type is accepted (only Nequi and Bancolombia)
      if (!this.voucherParserService.isAcceptedVoucherType(parsedVoucher.type)) {
        await this.messagingService.sendMessage(
          from,
          `❌ Comprobante rechazado.\n\n` +
            `⚠️ Solo se aceptan comprobantes de Nequi o Bancolombia.\n` +
            `Por favor envíe un comprobante válido.`,
        );
        this.logger.warn(`Rejected voucher - Invalid type: ${parsedVoucher.type}, From: ${from}`);
        return;
      }

      const detectedAmount = parsedVoucher.amount || ocrResult.amount;

      // ── Admin pay-for-others: intercept image when admin is in 'awaiting_image' step ──
      const adminPaySession = await this.redisService.get<AdminPaySession>(KEY_WA_ADMIN_PAY + from);
      if (adminPaySession && adminPaySession.step === 'awaiting_image') {
        // Upload image to R2 first
        let persistentImageUrl = imageUrl;
        let persistentStorageKey: string | undefined;
        if (this.storageService.isEnabled() && imageBuffer) {
          const storageKey = this.storageService.buildVoucherKey(
            adminPaySession.selectedPartnerId || 'unknown',
            parsedVoucher.type || 'voucher',
            imageMimeType,
          );
          const r2Url = await this.storageService.uploadVoucher(imageBuffer, storageKey, imageMimeType);
          if (r2Url) {
            persistentImageUrl = r2Url;
            persistentStorageKey = storageKey;
            this.logger.log(`Voucher stored in R2 (admin pay): ${storageKey}`);
          }
        }

        await this.redisService.del(KEY_WA_ADMIN_PAY + from);
        const partner = await this.partnersService.findById(adminPaySession.selectedPartnerId!);
        if (!partner) {
          await this.messagingService.sendMessage(from, '❌ No se encontró el socio seleccionado. Intenta de nuevo desde el menú.');
          return;
        }
        await this.registerPaymentForPartner(
          from, partner, detectedAmount, parsedVoucher,
          persistentImageUrl, imageId, messageId, false, persistentStorageKey,
        );
        return;
      }

      // Try to extract partner info from caption
      const raffleNumber = extractRaffleNumber(caption);

      // Normalize the phone number (remove country prefix and non-digits)
      const normalizedPhone = normalizePhone(from);

      // Try to find partner by cellphone first
      let partner = await this.partnersService.findByCelular(normalizedPhone);

      if (!partner && raffleNumber) {
        partner = await this.partnersService.findByNumeroRifa(raffleNumber);
      }

      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();

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

        await this.messagingService.sendMessage(
          from,
          `📸 ¡Comprobante recibido!\n\n` +
            `🏦 Tipo: *${parsedVoucher.type.toUpperCase()}*\n` +
            amountLine +
            `📅 Mes: *${getMonthName(currentMonth)} ${currentYear}*\n\n` +
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
      await this.messagingService.sendMessage(from, '❌ Ocurrió un error procesando el comprobante. Por favor intenta de nuevo.');
    }
  }

  /**
   * Register a payment for a found partner and send confirmation
   */
  async registerPaymentForPartner(
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
      const billing = determineBillingPeriod(paymentDate);

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

        await this.messagingService.sendMessage(from,
          `📅 *¿Para qué mes quieres registrar este pago?*\n\n` +
          `💰 Monto detectado: *$${detectedAmount.toLocaleString('es-CO')}*\n` +
          `👤 Socio: *${partner.nombre}*\n\n` +
          `1️⃣ *${getMonthName(billing.lateMonth!)} ${billing.lateYear!}* — ⚠️ Multa: $${billing.penalty!.toLocaleString('es-CO')} (${billing.daysLate!} día${billing.daysLate! > 1 ? 's' : ''} de retraso)\n` +
          `2️⃣ *${getMonthName(billing.onTimeMonth!)} ${billing.onTimeYear!}* — ✅ A tiempo\n\n` +
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
            await this.messagingService.sendMessage(from,
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
            await this.messagingService.sendMessage(from, msg);
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
              `📅 Mes: *${getMonthName(paymentMonth)} ${paymentYear}*\n` +
              `━━━━━━━━━━━━━━━━━━\n\n`;

            if (covered) {
              msg += `✅ *¡Pago completado!*\nSe acumularon ambos comprobantes exitosamente.\nSerá verificado pronto por el administrador.`;
            } else {
              const remaining = existingPayment.expectedAmount - newTotal;
              msg += `⚠️ *Pago parcial acumulado.*\nFaltan *$${remaining.toLocaleString('es-CO')}* para completar la cuota.`;
            }

            await this.messagingService.sendMessage(from, msg);
            return;
          } else {
            await this.messagingService.sendMessage(
              from,
              `⚠️ Ya existe un pago registrado para *${partner.nombre}* en *${getMonthName(paymentMonth)} ${paymentYear}* ` +
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
          `📅 Mes: *${getMonthName(paymentMonth)} ${paymentYear}*\n` +
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

        await this.messagingService.sendMessage(from, responseMessage);
      } catch (paymentError: any) {
        this.logger.error('Error creating payment:', paymentError);

        // Check if payment already exists for this month
        const isDuplicate = paymentError?.message?.toLowerCase().includes('already exists');
        if (isDuplicate) {
          await this.messagingService.sendMessage(
            from,
            `⚠️ Ya existe un pago registrado para *${partner.nombre}* en *${getMonthName(paymentMonth)} ${paymentYear}*.\n\n` +
              `Si crees que esto es un error, contacta al administrador.`,
          );
        } else {
          await this.messagingService.sendMessage(
            from,
            `📸 Comprobante recibido, pero ocurrió un error al registrar el pago.\n` +
              `Por favor contacta al administrador.`,
          );
        }
      }
    } else {
      // Amount not detected
      await this.messagingService.sendMessage(
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
   * Handle the user's response when asked whether a payment is for a sponsored partner.
   */
  async handleSponsorChoice(from: string, text: string, choice: PendingSponsorChoice): Promise<void> {
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
        await this.messagingService.sendMessage(from,
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
          await this.messagingService.sendMessage(from,
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
   */
  async handleMonthChoice(from: string, text: string, choice: PendingMonthChoice): Promise<void> {
    const option = text.trim();

    if (option === '1') {
      // Late payment for previous month (with penalty)
      await this.redisService.del(KEY_WA_MONTH_CHOICE + from);
      const partner = await this.partnersService.findById(choice.partnerId);
      if (!partner) {
        await this.messagingService.sendMessage(from, '❌ No se encontró el socio. Intenta enviar el comprobante de nuevo.');
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
        await this.messagingService.sendMessage(from, '❌ No se encontró el socio. Intenta enviar el comprobante de nuevo.');
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
      await this.messagingService.sendMessage(from,
        `⚠️ No entendí tu respuesta.\n\n` +
        `Responde *1* para *${getMonthName(choice.lateMonth)} ${choice.lateYear}* (con multa de $${choice.penalty.toLocaleString('es-CO')})\n` +
        `o *2* para *${getMonthName(choice.onTimeMonth)} ${choice.onTimeYear}* (a tiempo).\n\n` +
        `_Escribe CANCELAR para anular._`,
      );
    }
  }

  /**
   * Resume a pending session once the raffle number is provided
   */
  async resumeSessionWithRaffle(from: string, raffleNumber: number, session: PendingSession): Promise<void> {
    await this.redisService.del(KEY_WA_PENDING + from);

    const partner = await this.partnersService.findByNumeroRifa(raffleNumber);

    if (!partner) {
      await this.messagingService.sendMessage(
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
  async resumeSessionWithCelular(from: string, celular: string, session: PendingSession): Promise<void> {
    await this.redisService.del(KEY_WA_PENDING + from);

    const partner = await this.partnersService.findByCelular(celular);

    if (!partner) {
      await this.messagingService.sendMessage(
        from,
        `❌ No encontré ningún socio con el celular *${celular}*.\n\n` +
          `Intenta de nuevo con tu *número de rifa* o *celular del socio*,\n` +
          `o envía la imagen del comprobante nuevamente.`,
      );
      return;
    }

    await this.registerPaymentForPartner(from, partner, session.detectedAmount, session.parsedVoucher, session.imageUrl, session.imageId, session.messageId, false, session.storageKey);
  }

  // ─────────────────── ADMIN PAY FOR OTHERS ───────────────────

  /**
   * Start the "register payment for another partner" flow.
   * Shows a numbered list of active partners who have NOT paid for the current month.
   */
  async startAdminPayForPartner(from: string): Promise<void> {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthName = getMonthName(month);

    const allPartners = await this.partnersService.findAll();
    const activePartners = allPartners.filter(p => p.activo);

    const payments = await this.paymentsService.findByMonthAndYear(month, year);
    const paidPartnerIds = new Set(
      payments
        .filter(p => p.status === 'verified' || p.status === 'pending')
        .map(p => p.partnerId),
    );

    const unpaidPartners = activePartners
      .filter(p => !paidPartnerIds.has(p.id))
      .sort((a, b) => a.numeroRifa - b.numeroRifa);

    if (unpaidPartners.length === 0) {
      await this.messagingService.sendMessage(from,
        `✅ *¡Todos los socios activos ya pagaron ${monthName} ${year}!*\n\n` +
        `No hay pagos pendientes para registrar.`,
      );
      return;
    }

    // Save session in Redis
    await this.redisService.set(KEY_WA_ADMIN_PAY + from, {
      step: 'select_partner',
      month,
      year,
      unpaidPartners: unpaidPartners.map(p => ({
        id: p.id,
        nombre: p.nombre,
        numeroRifa: p.numeroRifa,
        montoCuota: p.montoCuota,
      })),
    } as AdminPaySession, PENDING_SESSION_TTL);

    // Build numbered list message
    let msg =
      `📋 *Socios con pago pendiente — ${monthName} ${year}*\n` +
      `Total: *${unpaidPartners.length}* socio${unpaidPartners.length !== 1 ? 's' : ''}\n\n`;

    unpaidPartners.forEach((p, i) => {
      msg += `${i + 1}. *${p.nombre}* (Rifa #${p.numeroRifa}) — $${p.montoCuota.toLocaleString('es-CO')}\n`;
    });

    msg += `\n_Responde con el *número* del socio para registrar su pago._\n`;
    msg += `_Escribe *CANCELAR* para anular._`;

    // Split if very long
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
  }

  /**
   * Handle admin's partner selection for the pay-for-others flow.
   */
  async handleAdminPartnerSelection(from: string, text: string, session: AdminPaySession): Promise<void> {
    const num = parseInt(text.replace(/\D/g, ''), 10);

    if (isNaN(num) || num < 1 || num > session.unpaidPartners.length) {
      await this.messagingService.sendMessage(from,
        `⚠️ Número inválido.\n\n` +
        `Responde con un número del *1* al *${session.unpaidPartners.length}*.\n\n` +
        `_Escribe *CANCELAR* para anular._`,
      );
      return;
    }

    const selected = session.unpaidPartners[num - 1];

    // Update session: advance to awaiting_image
    await this.redisService.set(KEY_WA_ADMIN_PAY + from, {
      ...session,
      step: 'awaiting_image',
      selectedPartnerId: selected.id,
      selectedPartnerName: selected.nombre,
      selectedPartnerNumeroRifa: selected.numeroRifa,
      selectedPartnerMontoCuota: selected.montoCuota,
    } as AdminPaySession, PENDING_SESSION_TTL);

    await this.messagingService.sendMessage(from,
      `👤 Socio seleccionado: *${selected.nombre}* (Rifa #${selected.numeroRifa})\n` +
      `💵 Cuota esperada: *$${selected.montoCuota.toLocaleString('es-CO')}*\n` +
      `📅 Mes: *${getMonthName(session.month)} ${session.year}*\n\n` +
      `📸 *Envía la foto del comprobante* (Nequi o Bancolombia) para registrar el pago.\n\n` +
      `_Escribe *CANCELAR* para anular._`,
    );
  }
}
