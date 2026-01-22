import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { WhatsAppService } from '../application/whatsapp.service';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  /**
   * Webhook verification endpoint (GET)
   * Meta sends a GET request to verify the webhook URL
   */
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const result = this.whatsappService.verifyWebhook(mode, token, challenge);

    if (result) {
      return res.status(HttpStatus.OK).send(result);
    }

    return res.status(HttpStatus.FORBIDDEN).send('Verification failed');
  }

  /**
   * Webhook endpoint for receiving messages (POST)
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(@Body() body: any) {
    // Process webhook asynchronously
    this.whatsappService.processWebhook(body);

    // Always return 200 OK immediately to acknowledge receipt
    return { status: 'received' };
  }
}
