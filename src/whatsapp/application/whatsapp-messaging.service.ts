import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../../users/application/users.service';
import { UserRole } from '../../users/domain/user.entity';
import axios from 'axios';

/**
 * Low-level WhatsApp messaging service.
 * Handles sending messages, downloading media, and admin phone lookups.
 * Extracted so all handlers can inject it without circular dependencies.
 */
@Injectable()
export class WhatsAppMessagingService {
  private readonly logger = new Logger(WhatsAppMessagingService.name);
  private readonly graphApiUrl = 'https://graph.facebook.com/v18.0';

  constructor(
    private readonly usersService: UsersService,
  ) {}

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
   * Get media URL from WhatsApp Graph API
   */
  async getMediaUrl(mediaId: string): Promise<string | null> {
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
   * Download a WhatsApp media file by its URL and return the buffer + mime type.
   */
  async downloadMedia(mediaUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const downloadRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    const buffer = Buffer.from(downloadRes.data);
    const mimeType = (downloadRes.headers['content-type'] as string) || 'image/jpeg';
    return { buffer, mimeType };
  }

  /**
   * Return the list of admin phone numbers from the DB (users with role ADMIN).
   * Phone numbers are returned in WhatsApp E.164 format (e.g. "573122249196").
   */
  async getAdminPhones(): Promise<string[]> {
    const admins = await this.usersService.findByRole(UserRole.ADMIN);
    return admins
      .map(u => u.celular ? `57${u.celular}` : '')
      .filter(p => p.length > 0);
  }

  /**
   * Check if a WhatsApp phone number (E.164 without '+') belongs to an admin user.
   */
  async isAdmin(from: string): Promise<boolean> {
    const phones = await this.getAdminPhones();
    return phones.includes(from);
  }
}
