import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { OcrService } from '../../whatsapp/application/ocr.service';
import { VoucherParserService } from '../../whatsapp/application/voucher-parser.service';
import { PaymentsService } from '../../payments/application/payments.service';
import { PartnersService } from '../../partners/application/partners.service';
import { ProcessVoucherDto } from './dto/process-voucher.dto';
import { VoucherResultDto } from './dto/voucher-result.dto';

@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);

  constructor(
    private readonly ocrService: OcrService,
    private readonly voucherParserService: VoucherParserService,
    private readonly paymentsService: PaymentsService,
    private readonly partnersService: PartnersService,
  ) {}

  /**
   * Process a manually uploaded voucher image
   */
  async processVoucher(dto: ProcessVoucherDto): Promise<VoucherResultDto> {
    this.logger.log(`Processing manual voucher for partner: ${dto.partnerId}`);

    // Get partner
    const partner = await this.partnersService.findById(dto.partnerId);
    if (!partner) {
      throw new NotFoundException(`Partner not found: ${dto.partnerId}`);
    }

    // Perform OCR on the image
    const ocrResult = await this.ocrService.extractAmountFromBase64(dto.imageBase64);

    // Parse the voucher
    const parsedVoucher = this.voucherParserService.parseVoucher(ocrResult.rawText || '');

    this.logger.log(`Parsed voucher: type=${parsedVoucher.type}, amount=${parsedVoucher.amount}, confidence=${parsedVoucher.confidence}`);

    // Check if voucher type is accepted
    if (!this.voucherParserService.isAcceptedVoucherType(parsedVoucher.type)) {
      return {
        success: false,
        voucher: {
          type: parsedVoucher.type,
          amount: parsedVoucher.amount,
          date: parsedVoucher.date?.toISOString() || null,
          destinationAccount: parsedVoucher.recipientAccount,
          referenceNumber: parsedVoucher.referenceNumber,
          confidence: parsedVoucher.confidence,
          rawText: ocrResult.rawText,
        },
        validation: {
          isValid: false,
          issues: [`Solo se aceptan comprobantes de Nequi o Bancolombia. Tipo detectado: ${parsedVoucher.type}`],
        },
        error: 'Voucher type not accepted',
      };
    }

    // Determine the amount (from parsed voucher or OCR)
    const detectedAmount = parsedVoucher.amount || ocrResult.amount;

    if (detectedAmount === null) {
      return {
        success: false,
        voucher: {
          type: parsedVoucher.type,
          amount: null,
          date: parsedVoucher.date?.toISOString() || null,
          destinationAccount: parsedVoucher.recipientAccount,
          referenceNumber: parsedVoucher.referenceNumber,
          confidence: parsedVoucher.confidence,
          rawText: ocrResult.rawText,
        },
        validation: {
          isValid: false,
          issues: ['No se pudo detectar el monto del pago en el comprobante'],
        },
        error: 'Amount not detected',
      };
    }

    // Determine month and year (use provided values or current date)
    const month = dto.month || (new Date().getMonth() + 1);
    const year = dto.year || new Date().getFullYear();

    // Validate voucher against expected amount and payment period
    const validation = this.voucherParserService.validatePaymentVoucher(
      parsedVoucher,
      partner.montoCuota,
      month,
      year,
    );

    // Add notes from validation
    if (dto.notes) {
      validation.issues.push(`Notas: ${dto.notes}`);
    }

    try {
      // Create payment with validation issues
      const payment = await this.paymentsService.createFromWhatsAppWithValidation(
        partner.id,
        detectedAmount,
        null, // No image URL for manual uploads
        null, // No WhatsApp message ID
        parsedVoucher.type,
        parsedVoucher.date,
        validation.issues,
      );

      this.logger.log(`Payment created for partner: ${partner.nombre}, amount: ${detectedAmount}, status: ${payment.status}`);

      return {
        success: true,
        payment: {
          id: payment.id,
          partnerId: payment.partnerId,
          partnerName: payment.partnerName,
          amount: payment.amount,
          expectedAmount: payment.expectedAmount,
          month: payment.month,
          monthName: payment.monthName,
          periodYear: payment.periodYear,
          status: payment.status,
          paymentDate: payment.paymentDate.toString(),
        },
        voucher: {
          type: parsedVoucher.type,
          amount: detectedAmount,
          date: parsedVoucher.date?.toISOString() || null,
          destinationAccount: parsedVoucher.recipientAccount,
          referenceNumber: parsedVoucher.referenceNumber,
          confidence: parsedVoucher.confidence,
          rawText: ocrResult.rawText,
        },
        validation: {
          isValid: validation.issues.length === 0,
          issues: validation.issues,
        },
      };
    } catch (error) {
      this.logger.error('Error creating payment:', error);
      return {
        success: false,
        voucher: {
          type: parsedVoucher.type,
          amount: detectedAmount,
          date: parsedVoucher.date?.toISOString() || null,
          destinationAccount: parsedVoucher.recipientAccount,
          referenceNumber: parsedVoucher.referenceNumber,
          confidence: parsedVoucher.confidence,
          rawText: ocrResult.rawText,
        },
        validation: {
          isValid: false,
          issues: validation.issues,
        },
        error: error.message || 'Error creating payment',
      };
    }
  }

  /**
   * Preview voucher without creating payment
   */
  async previewVoucher(imageBase64: string): Promise<Omit<VoucherResultDto, 'payment'>> {
    this.logger.log('Previewing voucher (no payment creation)');

    // Perform OCR on the image
    const ocrResult = await this.ocrService.extractAmountFromBase64(imageBase64);

    // Parse the voucher
    const parsedVoucher = this.voucherParserService.parseVoucher(ocrResult.rawText || '');

    const detectedAmount = parsedVoucher.amount || ocrResult.amount;
    const isAcceptedType = this.voucherParserService.isAcceptedVoucherType(parsedVoucher.type);

    const issues: string[] = [];
    if (!isAcceptedType) {
      issues.push(`Solo se aceptan comprobantes de Nequi o Bancolombia. Tipo detectado: ${parsedVoucher.type}`);
    }
    if (detectedAmount === null) {
      issues.push('No se pudo detectar el monto del pago en el comprobante');
    }

    return {
      success: isAcceptedType && detectedAmount !== null,
      voucher: {
        type: parsedVoucher.type,
        amount: detectedAmount,
        date: parsedVoucher.date?.toISOString() || null,
        destinationAccount: parsedVoucher.recipientAccount,
        referenceNumber: parsedVoucher.referenceNumber,
        confidence: parsedVoucher.confidence,
        rawText: ocrResult.rawText,
      },
      validation: {
        isValid: issues.length === 0,
        issues,
      },
    };
  }
}
