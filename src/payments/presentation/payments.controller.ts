import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from '../application/payments.service';
import { CreatePaymentDto } from '../application/dto/create-payment.dto';
import { UpdatePaymentDto } from '../application/dto/update-payment.dto';
import { PaymentStatus } from '../domain/payment.entity';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  async findAll() {
    return this.paymentsService.findAll();
  }

  @Get('partner/:partnerId')
  async findByPartnerId(@Param('partnerId') partnerId: string) {
    return this.paymentsService.findByPartnerId(partnerId);
  }

  @Get('period/:periodId')
  async findByPeriodId(@Param('periodId') periodId: string) {
    return this.paymentsService.findByPeriodId(periodId);
  }

  @Get('period/:periodId/month/:month')
  async findByPeriodAndMonth(
    @Param('periodId') periodId: string,
    @Param('month') month: string,
  ) {
    return this.paymentsService.findByPeriodAndMonth(periodId, parseInt(month, 10));
  }

  @Get('date-range')
  async findByDateRange(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.paymentsService.findByDateRange(startDate, endDate);
  }

  @Get('stats/year/:year')
  async getStatsByYear(@Param('year') year: string) {
    return this.paymentsService.getStatsByYear(parseInt(year, 10));
  }

  /**
   * Redirect to the presigned voucher URL.
   * Used by WhatsApp messages to avoid truncated presigned URLs.
   */
  @Get(':id/voucher')
  async redirectToVoucher(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const presignedUrl = await this.paymentsService.getVoucherPresignedUrl(id);
    if (!presignedUrl) {
      throw new NotFoundException('No voucher found for this payment');
    }
    return res.redirect(presignedUrl);
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }

  @Post()
  async create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updatePaymentDto: UpdatePaymentDto) {
    return this.paymentsService.update(id, updatePaymentDto);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: PaymentStatus,
  ) {
    return this.paymentsService.updateStatus(id, status);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string) {
    return this.paymentsService.delete(id);
  }
}
