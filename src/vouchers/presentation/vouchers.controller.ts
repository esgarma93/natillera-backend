import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { VouchersService } from '../application/vouchers.service';
import { ProcessVoucherDto } from '../application/dto/process-voucher.dto';

@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  /**
   * Process a voucher image and create a payment
   */
  @Post('process')
  @HttpCode(HttpStatus.OK)
  async processVoucher(@Body() dto: ProcessVoucherDto) {
    return this.vouchersService.processVoucher(dto);
  }

  /**
   * Preview a voucher without creating a payment
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async previewVoucher(@Body('imageBase64') imageBase64: string) {
    return this.vouchersService.previewVoucher(imageBase64);
  }
}
