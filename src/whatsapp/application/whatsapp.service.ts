import { Injectable, Logger } from '@nestjs/common';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { OcrService } from './ocr.service';
import { VoucherParserService } from './voucher-parser.service';
import axios from 'axios';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly graphApiUrl = 'https://graph.facebook.com/v18.0';

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly partnersService: PartnersService,
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

      // Try to find partner by cellphone number first (WhatsApp integration)
      let partner = null;
      let partnerIdentifier = contactName || `WhatsApp: ${from}`;

      // Normalize the phone number (remove + and any special characters)
      const normalizedPhone = from.replace(/\D/g, '');
      
      // Try to find partner by cellphone
      partner = await this.partnersService.findByCelular(normalizedPhone);
      
      if (partner) {
        partnerIdentifier = `${partner.nombre} (Rifa #${partner.numeroRifa})`;
      } else if (raffleNumber) {
        // Fallback: try to find partner by raffle number if provided in caption
        partner = await this.partnersService.findByNumeroRifa(raffleNumber);
        if (partner) {
          partnerIdentifier = `${partner.nombre} (Rifa #${partner.numeroRifa})`;
        }
      }

      // Determine current month for payment
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();

      const detectedAmount = parsedVoucher.amount || ocrResult.amount;

      if (detectedAmount !== null) {
        // If we found a partner, create a payment record with validation
        if (partner) {
          try {
            // Validate voucher against partner's expected amount and current period
            const validation = this.voucherParserService.validatePaymentVoucher(
              parsedVoucher,
              partner.montoCuota,
              currentMonth,
              currentYear,
            );

            // Create payment with appropriate status
            const paymentResult = await this.paymentsService.createFromWhatsAppWithValidation(
              partner.id,
              detectedAmount,
              imageUrl,
              messageId,
              parsedVoucher.type,
              parsedVoucher.date,
              validation.issues,
            );

            this.logger.log(`Payment record created for partner: ${partner.nombre}, status: ${paymentResult.status}`);

            // Build response message based on validation result
            let responseMessage = `📸 ¡Comprobante de pago recibido!\n\n` +
              `👤 Socio: ${partner.nombre}\n` +
              `🎰 Rifa: #${partner.numeroRifa}\n` +
              `💰 Monto detectado: $${detectedAmount.toLocaleString('es-CO')}\n` +
              `💵 Cuota esperada: $${partner.montoCuota.toLocaleString('es-CO')}\n` +
              `📅 Mes: ${this.getMonthName(currentMonth)} ${currentYear}\n` +
              `🏦 Tipo: ${parsedVoucher.type.toUpperCase()}\n\n`;

            if (validation.issues.length > 0) {
              responseMessage += `⚠️ Estado: PENDIENTE DE REVISIÓN\n\n` +
                `Observaciones:\n${validation.issues.map(i => `• ${i}`).join('\n')}\n\n` +
                `El pago será revisado manualmente por un administrador.`;
            } else {
              responseMessage += `✅ El pago ha sido registrado y será verificado pronto.\n` +
                `Si hay algún error, por favor responda con el monto correcto.`;
            }

            await this.sendMessage(from, responseMessage);
          } catch (paymentError) {
            this.logger.error('Error creating payment record:', paymentError);
            await this.sendMessage(
              from,
              `📸 ¡Comprobante recibido pero hubo un error al registrar el pago.\n` +
                `Por favor contacte al administrador.`,
            );
          }
        } else {
          // No partner found, ask for raffle number
          await this.sendMessage(
            from,
            `📸 ¡Comprobante de pago recibido!\n\n` +
              `🏦 Tipo: ${parsedVoucher.type.toUpperCase()}\n` +
              `💰 Monto detectado: $${detectedAmount.toLocaleString('es-CO')}\n` +
              `📅 Mes: ${this.getMonthName(currentMonth)} ${currentYear}\n\n` +
              `⚠️ No se encontró un socio asociado a su número de teléfono.\n` +
              `Por favor, asegúrese de que su número de celular (${normalizedPhone}) esté registrado en el sistema.\n` +
              `O responda con su número de rifa (ej: "#5" o "Rifa 5")`,
          );
        }
      } else {
        await this.sendMessage(
          from,
          `📸 ¡Comprobante de pago recibido!\n\n` +
            `🏦 Tipo: ${parsedVoucher.type.toUpperCase()}\n` +
            `⚠️ No se pudo detectar automáticamente el monto del pago.\n\n` +
            `${partner ? `Se identificó su cuenta correctamente.` : `No se encontró un socio asociado a su número de teléfono (${normalizedPhone}).`}\n\n` +
            `Por favor responda con:\n` +
            `${partner ? '' : `1. Su número de rifa (ej: "#5") o\n`}` +
            `${partner ? '- ' : '2. '}El monto del pago (ej: "150000")`,
        );
      }

      // Log for manual processing
      this.logger.log(
        `Payment voucher received - From: ${from}, Partner: ${partnerIdentifier}, Type: ${parsedVoucher.type}, Image: ${imageId}, Caption: ${caption}, Amount: ${detectedAmount}`,
      );
    } catch (error) {
      this.logger.error('Error handling image message:', error);
      await this.sendMessage(from, '❌ Error procesando el comprobante de pago. Por favor intente de nuevo.');
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
    const text = message.text?.body || '';

    this.logger.log(`Text message from ${from}: ${text}`);

    // Check if it's a payment amount confirmation
    const amount = this.ocrService.parseColombianCurrency(text);

    if (amount !== null) {
      await this.sendMessage(
        from,
        `✅ Amount confirmed: $${amount.toLocaleString()}\n\n` +
          `Please send the payment voucher image to complete the registration.`,
      );
    } else {
      // Default response
      await this.sendMessage(
        from,
        `👋 Hello! I'm the Natillera payment assistant.\n\n` +
          `To register a payment, please send:\n` +
          `📸 A photo of your payment voucher\n\n` +
          `You can include your name or raffle number in the caption.`,
      );
    }
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
}
