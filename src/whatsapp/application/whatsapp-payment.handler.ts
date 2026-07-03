import { Injectable, Logger } from '@nestjs/common';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { IntegrationsService } from '../../integrations/application/integrations.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../../storage/storage.service';
import { OcrService } from './ocr.service';
import { VoucherParserService } from './voucher-parser.service';
import { WhatsAppMessagingService } from './whatsapp-messaging.service';
import {
  PendingSession,
  PendingSponsorChoice,
  PendingMonthChoice,
  PendingIntegrationChoice,
  PendingComboAllocation,
  PendingGuestName,
  ComboAllocationItem,
  ComboOption,
  AdminPaySession,
  KEY_WA_PENDING,
  KEY_WA_SPONSOR,
  KEY_WA_MONTH_CHOICE,
  KEY_WA_ADMIN_PAY,
  KEY_WA_INTEGRATION_CHOICE,
  KEY_WA_COMBO_ALLOC,
  KEY_WA_GUEST_NAME,
  PENDING_SESSION_TTL,
} from './whatsapp.types';
import {
  normalizePhone,
  extractRaffleNumber,
  getMonthName,
  determineBillingPeriod,
  toColombiaDate,
  buildVoucherRedirectUrl,
} from './whatsapp.utils';

/**
 * Handles payment processing: image reception, voucher OCR, payment creation,
 * sponsor choice, month choice, and admin pay-for-others flow.
 */
@Injectable()
export class WhatsAppPaymentHandler {
  private readonly logger = new Logger(WhatsAppPaymentHandler.name);
  private readonly POLLA_FEE = 30_000;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly partnersService: PartnersService,
    private readonly integrationsService: IntegrationsService,
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
          adminPaySession.month, adminPaySession.year,
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

      const nowCOT = toColombiaDate(new Date());
      const currentMonth = nowCOT.getMonth() + 1;
      const currentYear = nowCOT.getFullYear();

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

    // ── Check for active integration: build combo allocation menu ──
    if (!skipSponsorCheck && detectedAmount !== null) {
      const pendingIntegrations = await this.integrationsService.findPendingForPayment();
      if (pendingIntegrations.length > 0) {
        const integration = pendingIntegrations[0];
        await this.showComboMenu(
          from, partner, detectedAmount, parsedVoucher, imageUrl, imageId, messageId,
          storageKey, paymentMonth, paymentYear, latePenalty,
          integration.id, integration.name, integration.totalCostPerPerson, integration.absentPenalty,
        );
        return;
      }
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
      // Detect Polla del Mundial 2026 entry fee bundled into the transfer.
      // When a partner pays cuota + $30k in a single transfer, we register
      // only the quota amount and note the polla fee separately.
      // Guard with !skipSponsorCheck: in recursive calls (split/sponsor flows) the amount
      // is already the exact quota, so polla detection should never fire there.
      // Also verify the amount doesn't coincidentally match a sponsored partner's quota —
      // in that case Case A (redirect to sponsored) takes priority over polla detection.
      let includesPollaFee = !skipSponsorCheck &&
        paymentMonth === 6 && paymentYear === 2026 &&
        detectedAmount === partner.montoCuota + this.POLLA_FEE;

      if (includesPollaFee) {
        const allPartners = await this.partnersService.findAll();
        const hasSponsoredWithSameQuota = allPartners.some(
          p => p.idPartnerPatrocinador === partner.id && p.activo && p.montoCuota === detectedAmount,
        );
        if (hasSponsoredWithSameQuota) {
          // The amount matches a sponsored partner's quota: let the sponsor check handle it
          // so the partner can redirect the payment to the sponsored partner (Case A).
          includesPollaFee = false;
        }
      }

      // effectiveAmount is what we register as the quota payment
      const effectiveAmount = includesPollaFee ? partner.montoCuota : detectedAmount;

      // ── Sponsored partner detection ──
      if (!skipSponsorCheck && !includesPollaFee && detectedAmount !== partner.montoCuota) {
        const allPartners = await this.partnersService.findAll();
        const sponsoredPartners = allPartners.filter(
          p => p.idPartnerPatrocinador === partner.id && p.activo,
        );

        // Case A: amount exactly matches a sponsored partner's quota → redirect entire payment
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
            overrideBillingMonth: paymentMonth,
            overrideBillingYear: paymentYear,
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

        // Case B: amount > partner's quota and there are sponsored partners → offer split
        if (detectedAmount > partner.montoCuota && sponsoredPartners.length > 0) {
          const excessAmount = detectedAmount - partner.montoCuota;

          await this.redisService.set(KEY_WA_SPONSOR + from, {
            imageId, imageUrl, messageId, detectedAmount, parsedVoucher, from,
            originalPartnerId: partner.id,
            originalPartnerName: partner.nombre,
            originalPartnerMontoCuota: partner.montoCuota,
            storageKey,
            isSplitPayment: true,
            excessAmount,
            overrideBillingMonth: paymentMonth,
            overrideBillingYear: paymentYear,
            sponsoredOptions: sponsoredPartners.map(p => ({
              id: p.id, nombre: p.nombre, numeroRifa: p.numeroRifa, montoCuota: p.montoCuota,
            })),
          } as PendingSponsorChoice, PENDING_SESSION_TTL);

          if (sponsoredPartners.length === 1) {
            const sp = sponsoredPartners[0];
            const amountForSponsored = Math.min(excessAmount, sp.montoCuota);
            await this.messagingService.sendMessage(from,
              `💰 *El monto excede la cuota del socio*\n\n` +
              `💰 Monto detectado: *$${detectedAmount.toLocaleString('es-CO')}*\n` +
              `💵 Cuota de *${partner.nombre}*: *$${partner.montoCuota.toLocaleString('es-CO')}*\n` +
              `📊 Excedente: *$${excessAmount.toLocaleString('es-CO')}*\n\n` +
              `El excedente se puede aplicar al patrocinado:\n` +
              `👤 *${sp.nombre}* (Rifa #${sp.numeroRifa}) — Cuota: $${sp.montoCuota.toLocaleString('es-CO')}\n\n` +
              `¿Registrar *$${partner.montoCuota.toLocaleString('es-CO')}* para *${partner.nombre}* y *$${amountForSponsored.toLocaleString('es-CO')}* para *${sp.nombre}*?\n` +
              `Responde *SÍ* o *NO*\n\n` +
              `_Escribe CANCELAR para anular._`,
            );
          } else {
            let msg =
              `💰 *El monto excede la cuota del socio*\n\n` +
              `💰 Monto detectado: *$${detectedAmount.toLocaleString('es-CO')}*\n` +
              `💵 Cuota de *${partner.nombre}*: *$${partner.montoCuota.toLocaleString('es-CO')}*\n` +
              `📊 Excedente: *$${excessAmount.toLocaleString('es-CO')}*\n\n` +
              `Patrocinados disponibles para aplicar el excedente:\n\n`;
            sponsoredPartners.forEach((sp, i) => {
              const amountForSp = Math.min(excessAmount, sp.montoCuota);
              msg += `${i + 1}️⃣ *${sp.nombre}* (Rifa #${sp.numeroRifa}) — Cuota: $${sp.montoCuota.toLocaleString('es-CO')} (se aplicarían $${amountForSp.toLocaleString('es-CO')})\n`;
            });
            msg += `\n¿A quién aplicar el excedente?\n` +
              `Responde con el *número* (1, 2...) o *NO* para registrar todo a *${partner.nombre}*.\n\n` +
              `_Escribe CANCELAR para anular._`;
            await this.messagingService.sendMessage(from, msg);
          }
          return;
        }
      }

      // ── Partial payment accumulation (quota only) ──
      try {
        const existingPayment = await this.paymentsService.findExistingPayment(
          partner.id, paymentMonth, paymentYear, 'quota',
        );

        if (existingPayment) {
          if (existingPayment.amount < existingPayment.expectedAmount) {
            await this.paymentsService.accumulatePartialPayment(
              existingPayment.id, effectiveAmount,
              imageUrl, storageKey, parsedVoucher.type,
            );

            const newTotal = existingPayment.amount + effectiveAmount;
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
        // When the payment amount differs from the original voucher amount (e.g. split payment
        // or polla fee bundled), use a copy of parsedVoucher with the adjusted amount so
        // validation compares correctly against the quota only.
        const voucherForValidation = (parsedVoucher.amount !== null && parsedVoucher.amount !== effectiveAmount)
          ? { ...parsedVoucher, amount: effectiveAmount }
          : parsedVoucher;

        const validation = this.voucherParserService.validatePaymentVoucher(
          voucherForValidation,
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
          effectiveAmount,
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
          (includesPollaFee
            ? `🏆 Incluye *$${this.POLLA_FEE.toLocaleString('es-CO')}* de entrada a la Polla del Mundial\n` +
              `💵 Cuota registrada: *$${partner.montoCuota.toLocaleString('es-CO')}*\n`
            : `💵 Cuota esperada: *$${partner.montoCuota.toLocaleString('es-CO')}*\n`) +
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
   * Supports two modes:
   * - Case A (redirect): the full amount matches a sponsored partner's quota
   * - Case B (split/isSplitPayment): amount > main partner quota, excess goes to sponsored
   */
  async handleSponsorChoice(from: string, text: string, choice: PendingSponsorChoice): Promise<void> {
    const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // ── Case B: Split payment (main + sponsored) ──
    if (choice.isSplitPayment) {
      await this.handleSplitSponsorChoice(from, textLower, text, choice);
      return;
    }

    // ── Case A: Redirect entire payment to a sponsored partner ──
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
            choice.overrideBillingMonth, choice.overrideBillingYear,
          );
        }
      } else if (textLower === 'no' || textLower === '2') {
        await this.redisService.del(KEY_WA_SPONSOR + from);
        const partner = await this.partnersService.findById(choice.originalPartnerId);
        if (partner) {
          await this.registerPaymentForPartner(
            from, partner, choice.detectedAmount, choice.parsedVoucher,
            choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
            choice.overrideBillingMonth, choice.overrideBillingYear,
          );
        }
      } else {
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
            choice.overrideBillingMonth, choice.overrideBillingYear,
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
              choice.overrideBillingMonth, choice.overrideBillingYear,
            );
          }
        } else {
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
   * Handle split payment confirmation: create payment for main partner at their quota,
   * then apply the excess to the selected sponsored partner(s).
   * Mirrors the frontend behavior in vouchers.service.ts.
   */
  private async handleSplitSponsorChoice(
    from: string, textLower: string, rawText: string, choice: PendingSponsorChoice,
  ): Promise<void> {
    const excessAmount = choice.excessAmount!;
    const paymentMonth = choice.overrideBillingMonth;
    const paymentYear = choice.overrideBillingYear;

    if (choice.sponsoredOptions.length === 1) {
      // Single sponsored → SÍ/NO
      if (textLower === 'si' || textLower === 'sí' || textLower === 'yes' || textLower === '1') {
        await this.redisService.del(KEY_WA_SPONSOR + from);
        const sponsored = choice.sponsoredOptions[0];

        // 1) Main partner payment at their quota
        const mainPartner = await this.partnersService.findById(choice.originalPartnerId);
        if (mainPartner) {
          await this.registerPaymentForPartner(
            from, mainPartner, mainPartner.montoCuota, choice.parsedVoucher,
            choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
            paymentMonth, paymentYear,
          );
        }

        // 2) Sponsored partner payment with the excess
        const sponsoredPartner = await this.partnersService.findById(sponsored.id);
        if (sponsoredPartner) {
          const amountForSponsored = Math.min(excessAmount, sponsoredPartner.montoCuota);
          await this.registerPaymentForPartner(
            from, sponsoredPartner, amountForSponsored, choice.parsedVoucher,
            choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
            paymentMonth, paymentYear,
          );
        }
      } else if (textLower === 'no' || textLower === '2') {
        // Register full amount for main partner only
        await this.redisService.del(KEY_WA_SPONSOR + from);
        const mainPartner = await this.partnersService.findById(choice.originalPartnerId);
        if (mainPartner) {
          await this.registerPaymentForPartner(
            from, mainPartner, choice.detectedAmount, choice.parsedVoucher,
            choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
            paymentMonth, paymentYear,
          );
        }
      } else {
        const sp = choice.sponsoredOptions[0];
        const amountForSponsored = Math.min(excessAmount, sp.montoCuota);
        await this.messagingService.sendMessage(from,
          `⚠️ No entendí tu respuesta.\n\n` +
          `Responde *SÍ* para dividir: *$${choice.originalPartnerMontoCuota.toLocaleString('es-CO')}* para *${choice.originalPartnerName}* ` +
          `y *$${amountForSponsored.toLocaleString('es-CO')}* para *${sp.nombre}*.\n` +
          `O *NO* para registrar todo a nombre de *${choice.originalPartnerName}*.\n\n` +
          `_Escribe CANCELAR para anular._`,
        );
      }
    } else {
      // Multiple sponsored options → pick by number or NO
      if (textLower === 'no') {
        await this.redisService.del(KEY_WA_SPONSOR + from);
        const mainPartner = await this.partnersService.findById(choice.originalPartnerId);
        if (mainPartner) {
          await this.registerPaymentForPartner(
            from, mainPartner, choice.detectedAmount, choice.parsedVoucher,
            choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
            paymentMonth, paymentYear,
          );
        }
      } else {
        const num = parseInt(rawText.replace(/\D/g, ''), 10);
        if (num >= 1 && num <= choice.sponsoredOptions.length) {
          await this.redisService.del(KEY_WA_SPONSOR + from);
          const sponsored = choice.sponsoredOptions[num - 1];

          // 1) Main partner payment at their quota
          const mainPartner = await this.partnersService.findById(choice.originalPartnerId);
          if (mainPartner) {
            await this.registerPaymentForPartner(
              from, mainPartner, mainPartner.montoCuota, choice.parsedVoucher,
              choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
              paymentMonth, paymentYear,
            );
          }

          // 2) Sponsored partner payment with the excess
          const sponsoredPartner = await this.partnersService.findById(sponsored.id);
          if (sponsoredPartner) {
            const amountForSponsored = Math.min(excessAmount, sponsoredPartner.montoCuota);
            await this.registerPaymentForPartner(
              from, sponsoredPartner, amountForSponsored, choice.parsedVoucher,
              choice.imageUrl, choice.imageId, choice.messageId, true, choice.storageKey,
              paymentMonth, paymentYear,
            );
          }
        } else {
          await this.messagingService.sendMessage(from,
            `⚠️ No entendí tu respuesta.\n\n` +
            `Responde con el *número* del patrocinado (1-${choice.sponsoredOptions.length}) para dividir el pago,\n` +
            `o *NO* para registrar todo a nombre de *${choice.originalPartnerName}*.\n\n` +
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
   * Handle the user's response when asked whether payment is for monthly quota or integration.
   * @deprecated kept for backward compat with stored Redis sessions; new flow uses showComboMenu
   */
  async handleIntegrationChoice(from: string, text: string, choice: PendingIntegrationChoice): Promise<void> {
    // Migrate any existing stored session to the new combo flow
    await this.redisService.del(KEY_WA_INTEGRATION_CHOICE + from);
    const partner = await this.partnersService.findById(choice.partnerId);
    if (!partner) {
      await this.messagingService.sendMessage(from, '❌ No se encontró el socio. Intenta enviar el comprobante de nuevo.');
      return;
    }
    await this.showComboMenu(
      from, partner, choice.detectedAmount, choice.parsedVoucher,
      choice.imageUrl, choice.imageId, choice.messageId,
      choice.storageKey, choice.billingMonth, choice.billingYear, choice.latePenalty,
      choice.integrationId, choice.integrationName,
      choice.integrationTotalCostPerPerson, choice.integrationAbsentPenalty,
    );
  }

  // ─────────────────── COMBO ALLOCATION FLOW ───────────────────

  /**
   * Build and store a combo allocation menu. Called when an active integration is detected.
   * Shows all the ways a single voucher can be split across quota, integration, sponsored partners and guests.
   */
  private async showComboMenu(
    from: string,
    partner: any,
    detectedAmount: number,
    parsedVoucher: any,
    imageUrl: string,
    imageId: string,
    messageId: string,
    storageKey: string | undefined,
    billingMonth: number,
    billingYear: number,
    latePenalty: number | undefined,
    integrationId: string,
    integrationName: string,
    integrationTotalCostPerPerson: number,
    integrationAbsentPenalty: number,
  ): Promise<void> {
    const allPartners = await this.partnersService.findAll();
    const sponsoredPartners = allPartners.filter(p => p.idPartnerPatrocinador === partner.id && p.activo);

    const options = this.buildComboOptions(
      detectedAmount, partner, integrationId, integrationName,
      integrationTotalCostPerPerson, integrationAbsentPenalty,
      sponsoredPartners,
    );

    const combo: PendingComboAllocation = {
      partnerId: partner.id,
      partnerName: partner.nombre,
      partnerMontoCuota: partner.montoCuota,
      detectedAmount,
      remainingAmount: detectedAmount,
      parsedVoucher,
      imageUrl,
      imageId,
      messageId,
      storageKey,
      billingMonth,
      billingYear,
      latePenalty,
      integrationId,
      integrationName,
      integrationTotalCostPerPerson,
      integrationAbsentPenalty,
      committedAllocations: [],
      step: 'main_choice',
      currentOptions: options,
      sponsoredOptions: sponsoredPartners.map(p => ({
        id: p.id, nombre: p.nombre, numeroRifa: p.numeroRifa, montoCuota: p.montoCuota,
      })),
    };

    await this.redisService.set(KEY_WA_COMBO_ALLOC + from, combo, PENDING_SESSION_TTL);
    await this.messagingService.sendMessage(from, this.formatComboMenu(combo, partner.nombre));
  }

  /**
   * Build the list of selectable options for a combo menu given the remaining amount and context.
   */
  private buildComboOptions(
    remaining: number,
    partner: any,
    integrationId: string,
    integrationName: string,
    integrationFull: number,
    integrationAbsent: number,
    sponsoredPartners: any[],
  ): ComboOption[] {
    const opts: ComboOption[] = [];
    const quota = partner.montoCuota as number;

    if (quota > 0) {
      // Option: only own quota
      if (remaining >= quota) {
        opts.push({
          label: `Cuota mensual de *${partner.nombre}* — $${quota.toLocaleString('es-CO')}`,
          cost: quota,
          allocations: [{ type: 'quota', partnerId: partner.id, partnerName: partner.nombre, amount: quota }],
        });
      }

      // Option: quota + integration (attendee) combo
      if (remaining >= quota + integrationFull) {
        opts.push({
          label: `Cuota + Integración asistente (*${partner.nombre}*) — $${(quota + integrationFull).toLocaleString('es-CO')}`,
          cost: quota + integrationFull,
          allocations: [
            { type: 'quota', partnerId: partner.id, partnerName: partner.nombre, amount: quota },
            { type: 'integration', partnerId: partner.id, partnerName: partner.nombre, amount: integrationFull, integrationId, integrationName, isAbsent: false },
          ],
        });
      }

      // Option: quota + integration (absent)
      if (remaining >= quota + integrationAbsent && integrationAbsent !== integrationFull) {
        opts.push({
          label: `Cuota + Integración ausente (*${partner.nombre}*) — $${(quota + integrationAbsent).toLocaleString('es-CO')}`,
          cost: quota + integrationAbsent,
          allocations: [
            { type: 'quota', partnerId: partner.id, partnerName: partner.nombre, amount: quota },
            { type: 'integration', partnerId: partner.id, partnerName: partner.nombre, amount: integrationAbsent, integrationId, integrationName, isAbsent: true },
          ],
        });
      }

      // Sponsored: own quota + sponsored quota
      for (const sp of sponsoredPartners) {
        if (remaining >= quota + sp.montoCuota) {
          opts.push({
            label: `Cuota de *${partner.nombre}* + Cuota de *${sp.nombre}* — $${(quota + sp.montoCuota).toLocaleString('es-CO')}`,
            cost: quota + sp.montoCuota,
            allocations: [
              { type: 'quota', partnerId: partner.id, partnerName: partner.nombre, amount: quota },
              { type: 'quota', partnerId: sp.id, partnerName: sp.nombre, amount: sp.montoCuota },
            ],
          });
        }
        // quota + own integration attendee + sponsored quota
        if (remaining >= quota + integrationFull + sp.montoCuota) {
          opts.push({
            label: `Cuota + Integración asistente (*${partner.nombre}*) + Cuota de *${sp.nombre}* — $${(quota + integrationFull + sp.montoCuota).toLocaleString('es-CO')}`,
            cost: quota + integrationFull + sp.montoCuota,
            allocations: [
              { type: 'quota', partnerId: partner.id, partnerName: partner.nombre, amount: quota },
              { type: 'integration', partnerId: partner.id, partnerName: partner.nombre, amount: integrationFull, integrationId, integrationName, isAbsent: false },
              { type: 'quota', partnerId: sp.id, partnerName: sp.nombre, amount: sp.montoCuota },
            ],
          });
        }
        // quota + own integration attendee + sponsored integration attendee
        if (remaining >= quota + integrationFull + integrationFull) {
          opts.push({
            label: `Cuota + Integración asistente (*${partner.nombre}*) + Integración asistente (*${sp.nombre}*) — $${(quota + integrationFull * 2).toLocaleString('es-CO')}`,
            cost: quota + integrationFull * 2,
            allocations: [
              { type: 'quota', partnerId: partner.id, partnerName: partner.nombre, amount: quota },
              { type: 'integration', partnerId: partner.id, partnerName: partner.nombre, amount: integrationFull, integrationId, integrationName, isAbsent: false },
              { type: 'integration', partnerId: sp.id, partnerName: sp.nombre, amount: integrationFull, integrationId, integrationName, isAbsent: false },
            ],
          });
        }
      }
    }

    // Option: only own integration (attendee)
    if (remaining >= integrationFull) {
      opts.push({
        label: `Integración *${integrationName}* asistente (*${partner.nombre}*) — $${integrationFull.toLocaleString('es-CO')}`,
        cost: integrationFull,
        allocations: [{
          type: 'integration', partnerId: partner.id, partnerName: partner.nombre,
          amount: integrationFull, integrationId, integrationName, isAbsent: false,
        }],
      });
    }

    // Option: only own integration (absent)
    if (remaining >= integrationAbsent && integrationAbsent !== integrationFull) {
      opts.push({
        label: `Integración *${integrationName}* ausente (*${partner.nombre}*) — $${integrationAbsent.toLocaleString('es-CO')}`,
        cost: integrationAbsent,
        allocations: [{
          type: 'integration', partnerId: partner.id, partnerName: partner.nombre,
          amount: integrationAbsent, integrationId, integrationName, isAbsent: true,
        }],
      });
    }

    // Sponsored partner options (quota only)
    for (const sp of sponsoredPartners) {
      if (remaining >= sp.montoCuota) {
        opts.push({
          label: `Cuota de patrocinado *${sp.nombre}* — $${sp.montoCuota.toLocaleString('es-CO')}`,
          cost: sp.montoCuota,
          allocations: [{ type: 'quota', partnerId: sp.id, partnerName: sp.nombre, amount: sp.montoCuota }],
        });
      }
      // Sponsored integration attendee
      if (remaining >= integrationFull) {
        opts.push({
          label: `Integración asistente de patrocinado *${sp.nombre}* — $${integrationFull.toLocaleString('es-CO')}`,
          cost: integrationFull,
          allocations: [{
            type: 'integration', partnerId: sp.id, partnerName: sp.nombre,
            amount: integrationFull, integrationId, integrationName, isAbsent: false,
          }],
        });
      }
    }

    // Guest option
    if (remaining >= integrationFull) {
      opts.push({
        label: `Entrada de un *invitado* a ${integrationName} — $${integrationFull.toLocaleString('es-CO')} _(se pedirá el nombre)_`,
        cost: integrationFull,
        allocations: [{
          type: 'integration', partnerId: partner.id, partnerName: 'Invitado',
          amount: integrationFull, integrationId, integrationName, isAbsent: false,
          isGuest: true, invitedByPartnerId: partner.id,
        }],
      });
    }

    return opts;
  }

  /** Format combo menu message for WhatsApp */
  private formatComboMenu(combo: PendingComboAllocation, partnerName: string): string {
    const { remainingAmount, currentOptions, integrationName, committedAllocations } = combo;
    let msg = '';

    if (committedAllocations.length > 0) {
      const allocated = combo.detectedAmount - remainingAmount;
      msg += `✅ *Ya asignado ($${allocated.toLocaleString('es-CO')}):*\n`;
      for (const a of committedAllocations) {
        const label = a.isGuest ? `Invitado *${a.guestName || 'Invitado'}*` : `*${a.partnerName}*`;
        msg += `• ${a.type === 'quota' ? 'Cuota' : 'Integración'} de ${label}: $${a.amount.toLocaleString('es-CO')}\n`;
      }
      msg += `\n💰 *Excedente disponible: $${remainingAmount.toLocaleString('es-CO')}*\n\n`;
      msg += `*¿Con el excedente quieres pagar?*\n\n`;
    } else {
      msg += `🎉 *Integración activa: ${integrationName}*\n\n`;
      msg += `💰 Monto: *$${remainingAmount.toLocaleString('es-CO')}*\n`;
      msg += `👤 Socio: *${partnerName}*\n\n`;
      msg += `*¿Qué cubre este comprobante?*\n\n`;
    }

    if (currentOptions.length === 0) {
      return msg + `_No hay más pagos que cubrir con este monto._`;
    }

    for (let i = 0; i < currentOptions.length; i++) {
      const opt = currentOptions[i];
      const exact = opt.cost === remainingAmount ? ' ✓' : '';
      msg += `${i + 1}️⃣ ${opt.label}${exact}\n`;
    }

    msg += `\n_Responde con el número. Escribe *NADA* si no quieres asignar más. Escribe *CANCELAR* para anular todo._`;
    return msg;
  }

  /**
   * Handle the user's option choice in the combo allocation flow.
   */
  async handleComboChoice(from: string, text: string, combo: PendingComboAllocation): Promise<void> {
    const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // NADA → commit what we have or fall back to full amount as quota for main partner
    if (textLower === 'nada' || textLower === 'ninguno' || textLower === 'no') {
      await this.redisService.del(KEY_WA_COMBO_ALLOC + from);
      if (combo.committedAllocations.length === 0) {
        // Nothing allocated — fall back: register full amount under main partner as quota
        const partner = await this.partnersService.findById(combo.partnerId);
        if (partner) {
          await this.registerPaymentForPartner(
            from, partner, combo.detectedAmount, combo.parsedVoucher,
            combo.imageUrl, combo.imageId, combo.messageId,
            true, combo.storageKey, combo.billingMonth, combo.billingYear, combo.latePenalty,
          );
        }
      } else {
        await this.commitComboAllocations(from, combo);
      }
      return;
    }

    const num = parseInt(text.replace(/\D/g, ''), 10);
    if (isNaN(num) || num < 1 || num > combo.currentOptions.length) {
      await this.messagingService.sendMessage(from,
        `⚠️ No entendí tu respuesta.\n\n` +
        `Responde con un número del 1 al ${combo.currentOptions.length},\n` +
        `*NADA* para no asignar más, o *CANCELAR* para anular.\n`,
      );
      return;
    }

    const chosen = combo.currentOptions[num - 1];

    // If the chosen option includes a guest, we need to ask for the guest name
    const guestAlloc = chosen.allocations.find(a => a.isGuest);
    if (guestAlloc) {
      const nonGuestAllocs = chosen.allocations.filter(a => !a.isGuest);
      const guestNameSession: PendingGuestName = {
        combo: {
          ...combo,
          committedAllocations: [...combo.committedAllocations, ...nonGuestAllocs, guestAlloc],
          remainingAmount: combo.remainingAmount - chosen.cost,
          currentOptions: [],
        },
      };
      await this.redisService.del(KEY_WA_COMBO_ALLOC + from);
      await this.redisService.set(KEY_WA_GUEST_NAME + from, guestNameSession, PENDING_SESSION_TTL);
      await this.messagingService.sendMessage(from,
        `👤 *¿Cómo se llama el invitado?*\n\n` +
        `Ingresa el nombre completo del invitado que vas a pagar para *${combo.integrationName}*.\n\n` +
        `_Escribe CANCELAR para anular._`,
      );
      return;
    }

    // Commit the chosen allocations
    const newCommitted = [...combo.committedAllocations, ...chosen.allocations];
    const newRemaining = combo.remainingAmount - chosen.cost;

    if (newRemaining <= 0) {
      const finalCombo: PendingComboAllocation = {
        ...combo, committedAllocations: newCommitted, remainingAmount: 0, currentOptions: [],
      };
      await this.redisService.del(KEY_WA_COMBO_ALLOC + from);
      await this.commitComboAllocations(from, finalCombo);
      return;
    }

    // There's remaining — build new options excluding already-allocated combinations
    const allocatedKeys = new Set(newCommitted.map(a => `${a.partnerId}:${a.type}`));
    const allPartners = await this.partnersService.findAll();
    const partner = await this.partnersService.findById(combo.partnerId);
    if (!partner) {
      await this.redisService.del(KEY_WA_COMBO_ALLOC + from);
      await this.messagingService.sendMessage(from, '❌ Error: socio no encontrado.');
      return;
    }

    const sponsoredPartners = allPartners
      .filter(sp => sp.idPartnerPatrocinador === partner.id && sp.activo)
      .filter(sp => !allocatedKeys.has(`${sp.id}:quota`) && !allocatedKeys.has(`${sp.id}:integration`));

    const partnerForOptions = allocatedKeys.has(`${partner.id}:quota`)
      ? { ...partner, montoCuota: 0 }
      : partner;

    const newOptions = this.buildComboOptions(
      newRemaining, partnerForOptions,
      combo.integrationId, combo.integrationName,
      combo.integrationTotalCostPerPerson, combo.integrationAbsentPenalty,
      sponsoredPartners,
    ).filter(opt => !opt.allocations.every(a => allocatedKeys.has(`${a.partnerId}:${a.type}`)));

    const updatedCombo: PendingComboAllocation = {
      ...combo, committedAllocations: newCommitted, remainingAmount: newRemaining,
      currentOptions: newOptions,
    };

    if (newOptions.length === 0) {
      await this.redisService.del(KEY_WA_COMBO_ALLOC + from);
      await this.commitComboAllocations(from, updatedCombo);
      return;
    }

    await this.redisService.set(KEY_WA_COMBO_ALLOC + from, updatedCombo, PENDING_SESSION_TTL);
    await this.messagingService.sendMessage(from, this.formatComboMenu(updatedCombo, partner.nombre));
  }

  /**
   * Handle the user's input for the guest name in the guest payment flow.
   */
  async handleGuestName(from: string, text: string, session: PendingGuestName): Promise<void> {
    const guestName = text.trim();
    await this.redisService.del(KEY_WA_GUEST_NAME + from);

    const updatedAllocations = session.combo.committedAllocations.map(a =>
      a.isGuest ? { ...a, guestName } : a,
    );

    await this.commitComboAllocations(from, { ...session.combo, committedAllocations: updatedAllocations });
  }

  /**
   * Execute all committed allocations and send a summary message.
   */
  private async commitComboAllocations(from: string, combo: PendingComboAllocation): Promise<void> {
    const results: string[] = [];
    let anyError = false;

    for (const alloc of combo.committedAllocations) {
      try {
        if (alloc.type === 'quota') {
          await this.createQuotaPaymentFromCombo(combo, alloc, from);
          results.push(`✅ Cuota de *${alloc.partnerName}*: $${alloc.amount.toLocaleString('es-CO')}`);
        } else {
          await this.createIntegrationPaymentFromCombo(combo, alloc, from);
          const label = alloc.isGuest
            ? `Invitado *${alloc.guestName || 'Invitado'}* (asistente a ${alloc.integrationName})`
            : `*${alloc.partnerName}* (${alloc.isAbsent ? 'ausente' : 'asistente'} a ${alloc.integrationName})`;
          results.push(`✅ Integración ${label}: $${alloc.amount.toLocaleString('es-CO')}`);
        }
      } catch (err: any) {
        this.logger.error(`Error committing allocation for ${alloc.partnerName}:`, err);
        const isDup = err?.message?.toLowerCase().includes('already exists');
        results.push(`⚠️ ${alloc.type === 'quota' ? 'Cuota' : 'Integración'} de *${alloc.partnerName}*: ${isDup ? 'Ya existía un pago' : 'Error al registrar'}`);
        anyError = true;
      }
    }

    const summary =
      `📸 *Comprobante procesado*\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `👤 Socio: *${combo.partnerName}*\n` +
      `💰 Monto total: *$${combo.detectedAmount.toLocaleString('es-CO')}*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      results.join('\n') +
      (combo.remainingAmount > 0 ? `\n\n💰 Excedente no asignado: $${combo.remainingAmount.toLocaleString('es-CO')}` : '') +
      `\n\n${anyError ? '⚠️ Algunos pagos requieren revisión manual.' : '🎉 Serán verificados pronto por el administrador.'}`;

    await this.messagingService.sendMessage(from, summary);
  }

  /** Create a quota payment for one combo allocation item */
  private async createQuotaPaymentFromCombo(
    combo: PendingComboAllocation, alloc: ComboAllocationItem, from: string,
  ): Promise<void> {
    const voucherForValidation = { ...combo.parsedVoucher, amount: alloc.amount };
    const validation = this.voucherParserService.validatePaymentVoucher(
      voucherForValidation, alloc.amount, combo.billingMonth, combo.billingYear,
    );
    if (combo.latePenalty && combo.latePenalty > 0) {
      const daysLate = Math.round(combo.latePenalty / 2000);
      validation.issues.push(`Multa por pago tardío: $${combo.latePenalty.toLocaleString('es-CO')} (${daysLate} día${daysLate > 1 ? 's' : ''} de retraso)`);
    }
    await this.paymentsService.createFromWhatsAppWithValidation(
      alloc.partnerId, alloc.amount,
      combo.imageUrl, combo.messageId, combo.parsedVoucher.type,
      combo.parsedVoucher.date, validation.issues, combo.storageKey,
      from, combo.billingMonth,
    );
  }

  /** Create an integration payment for one combo allocation item */
  private async createIntegrationPaymentFromCombo(
    combo: PendingComboAllocation, alloc: ComboAllocationItem, from: string,
  ): Promise<void> {
    const expectedAmount = alloc.isAbsent ? combo.integrationAbsentPenalty : combo.integrationTotalCostPerPerson;
    const voucherForValidation = { ...combo.parsedVoucher, amount: alloc.amount };
    const validation = this.voucherParserService.validatePaymentVoucher(
      voucherForValidation, expectedAmount, combo.billingMonth, combo.billingYear,
    );

    // Guests are registered under the inviting partner's ID
    const paymentPartnerId = alloc.isGuest ? combo.partnerId : alloc.partnerId;

    const paymentResult = await this.paymentsService.createFromWhatsAppWithValidation(
      paymentPartnerId, alloc.amount,
      combo.imageUrl, combo.messageId, combo.parsedVoucher.type,
      combo.parsedVoucher.date, validation.issues, combo.storageKey,
      from, combo.billingMonth, 'integration', alloc.integrationId,
    );

    if (alloc.isGuest) {
      // Add as a named guest attendee via direct integration update
      await this.integrationsService.addGuestAttendeeFromPayment(
        alloc.integrationId!, alloc.guestName || 'Invitado',
        combo.partnerId, paymentResult.id,
      );
    } else if (alloc.isAbsent) {
      await this.integrationsService.addAbsentFromPayment(alloc.integrationId!, alloc.partnerId);
    } else {
      await this.integrationsService.addAttendeeFromPayment(
        alloc.integrationId!, alloc.partnerId, alloc.partnerName, paymentResult.id,
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
    const billing = determineBillingPeriod(now);
    // For the admin "pay for others" list, use the billing period month.
    // On ambiguous days (6-14), default to lateMonth (catching up on late payments).
    const month = billing.status === 'ambiguous' ? billing.lateMonth! : billing.month;
    const year = billing.status === 'ambiguous' ? billing.lateYear! : billing.year;
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
