import { Injectable, Logger } from '@nestjs/common';
import { PaymentsService } from '../../payments/application/payments.service';
import { OcrService } from './ocr.service';
import axios from 'axios';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly graphApiUrl = 'https://graph.facebook.com/v18.0';

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly ocrService: OcrService,
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

    this.logger.log(`Processing image message. ID: ${imageId}, Caption: ${caption}`);

    try {
      // Get image URL from WhatsApp
      const imageUrl = await this.getMediaUrl(imageId);

      if (!imageUrl) {
        await this.sendMessage(from, '❌ Could not process the image. Please try again.');
        return;
      }

      // Try to extract amount using OCR
      const ocrResult = await this.ocrService.extractAmountFromImage(imageUrl);

      // Try to extract partner info from caption or contact name
      // Caption format expected: "Partner Name" or "#RaffleNumber"
      const partnerInfo = this.extractPartnerInfo(caption, contact?.profile?.name);

      if (ocrResult.amount !== null) {
        await this.sendMessage(
          from,
          `📸 Payment voucher received!\n\n` +
            `💰 Detected amount: $${ocrResult.amount.toLocaleString()}\n` +
            `👤 From: ${partnerInfo || 'Unknown'}\n\n` +
            `Please confirm this information or reply with corrections.`,
        );
      } else {
        await this.sendMessage(
          from,
          `📸 Payment voucher received!\n\n` +
            `⚠️ Could not automatically detect the payment amount.\n` +
            `Please reply with the payment amount (e.g., "150000")`,
        );
      }

      // Log for manual processing
      this.logger.log(
        `Payment voucher received - From: ${from}, Image: ${imageId}, Caption: ${caption}, OCR Amount: ${ocrResult.amount}`,
      );
    } catch (error) {
      this.logger.error('Error handling image message:', error);
      await this.sendMessage(from, '❌ Error processing payment voucher. Please try again.');
    }
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

  /**
   * Extract partner info from caption or contact name
   */
  private extractPartnerInfo(caption: string, contactName?: string): string | null {
    // Try to extract raffle number from caption (e.g., "#5" or "Rifa 5")
    const raffleMatch = caption.match(/#?(\d+)/);
    if (raffleMatch) {
      return `Raffle #${raffleMatch[1]}`;
    }

    // Use contact name if available
    if (contactName) {
      return contactName;
    }

    // Use caption as name if not empty
    if (caption.trim()) {
      return caption.trim();
    }

    return null;
  }
}
