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

    // Check for critical validation errors (wrong destination account)
    const hasCriticalError = validation.issues.some(issue => 
      issue.includes('cuenta destino') || issue.includes('cuenta de la natillera')
    );

    if (hasCriticalError) {
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
        error: 'Destination account validation failed',
      };
    }

    // Add notes from validation
    if (dto.notes) {
      validation.issues.push(`Notas: ${dto.notes}`);
    }

    // Calculate excess amount
    const excessAmount = detectedAmount - partner.montoCuota;

    // Get all partners to find sponsored ones
    const allPartners = await this.partnersService.findAll();
    const sponsoredPartners = allPartners.filter(
      p => p.idPartnerPatrocinador === partner.id && p.activo
    );

    this.logger.log(`Partner ${partner.nombre} has ${sponsoredPartners.length} sponsored partners. Excess: ${excessAmount}`);

    // If there's excess but no sponsored partners, add warning to validation issues
    if (excessAmount > 0 && sponsoredPartners.length === 0) {
      validation.issues.push(
        `ADVERTENCIA: El monto del comprobante ($${detectedAmount.toLocaleString('es-CO')}) excede la cuota esperada ($${partner.montoCuota.toLocaleString('es-CO')}) por $${excessAmount.toLocaleString('es-CO')}. ` +
        `El socio no tiene patrocinados para aplicar el excedente. Este pago requiere verificación manual.`
      );
      this.logger.warn(`Excess amount ${excessAmount} detected but no sponsored partners found for ${partner.nombre}`);
    }

    // If there's excess and sponsored partners but no selection provided, return for user selection
    if (excessAmount > 0 && sponsoredPartners.length > 0 && !dto.sponsoredPartnerIds) {
      return {
        success: false,
        needsSponsorSelection: true,
        excessAmount,
        sponsoredPartners: sponsoredPartners.map(sp => ({
          id: sp.id,
          nombre: sp.nombre,
          numeroRifa: sp.numeroRifa,
          montoCuota: sp.montoCuota,
        })),
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
        error: 'Sponsor selection required for excess payment',
      };
    }

    try {
      // Create main payment
      const payment = await this.paymentsService.createFromWhatsAppWithValidation(
        partner.id,
        partner.montoCuota, // Only pay the expected amount
        null, // No image URL for manual uploads
        null, // No WhatsApp message ID
        parsedVoucher.type,
        parsedVoucher.date,
        validation.issues,
      );

      this.logger.log(`Payment created for partner: ${partner.nombre}, amount: ${partner.montoCuota}, status: ${payment.status}`);

      const result: any = {
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

      // Handle excess payment to sponsored partners
      if (excessAmount > 0 && dto.sponsoredPartnerIds && dto.sponsoredPartnerIds.length > 0) {
        let remainingExcess = excessAmount;
        const additionalPayments = [];

        for (const sponsoredId of dto.sponsoredPartnerIds) {
          if (remainingExcess <= 0) break;

          const sponsoredPartner = sponsoredPartners.find(sp => sp.id === sponsoredId);
          if (!sponsoredPartner) continue;

          const amountToApply = Math.min(remainingExcess, sponsoredPartner.montoCuota);
          
          try {
            const sponsoredPayment = await this.paymentsService.createFromWhatsAppWithValidation(
              sponsoredPartner.id,
              amountToApply,
              null,
              null,
              parsedVoucher.type,
              parsedVoucher.date,
              [`Pago aplicado del excedente del socio ${partner.nombre}`],
            );

            additionalPayments.push({
              id: sponsoredPayment.id,
              partnerId: sponsoredPayment.partnerId,
              partnerName: sponsoredPayment.partnerName,
              amount: sponsoredPayment.amount,
              expectedAmount: sponsoredPayment.expectedAmount,
              month: sponsoredPayment.month,
              monthName: sponsoredPayment.monthName,
              periodYear: sponsoredPayment.periodYear,
              status: sponsoredPayment.status,
              paymentDate: sponsoredPayment.paymentDate.toString(),
            });

            remainingExcess -= amountToApply;
            this.logger.log(`Applied ${amountToApply} to sponsored partner ${sponsoredPartner.nombre}. Remaining: ${remainingExcess}`);
          } catch (error) {
            this.logger.error(`Error creating payment for sponsored partner ${sponsoredPartner.nombre}:`, error);
          }
        }

        result.additionalPayments = additionalPayments;
        result.excessAmount = remainingExcess;

        // Check if more sponsored partners are available for remaining excess
        const usedSponsorIds = dto.sponsoredPartnerIds;
        const remainingSponsors = sponsoredPartners.filter(sp => !usedSponsorIds.includes(sp.id));
        
        if (remainingExcess > 0 && remainingSponsors.length > 0) {
          result.needsSponsorSelection = true;
          result.sponsoredPartners = remainingSponsors.map(sp => ({
            id: sp.id,
            nombre: sp.nombre,
            numeroRifa: sp.numeroRifa,
            montoCuota: sp.montoCuota,
          }));
        }
      }

      return result;
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

    // Validate destination account
    if (parsedVoucher.recipientAccount) {
      const normalizeAccount = (account: string) => account.replace(/[-\s.]/g, '');
      const detectedAccount = normalizeAccount(parsedVoucher.recipientAccount);
      const expectedAccount = normalizeAccount('33177135742');
      
      if (detectedAccount !== expectedAccount) {
        issues.push(`La cuenta destino (${parsedVoucher.recipientAccount}) no coincide con la cuenta de la natillera (33177135742).`);
      }
    }

    return {
      success: isAcceptedType && detectedAmount !== null && issues.length === 0,
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
