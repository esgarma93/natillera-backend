import { Injectable, Logger } from '@nestjs/common';

/**
 * Supported voucher types (only Nequi and Bancolombia are accepted)
 */
export enum VoucherType {
  BANCOLOMBIA = 'bancolombia',
  NEQUI = 'nequi',
  UNKNOWN = 'unknown',
}

/**
 * Parsed voucher data
 */
export interface ParsedVoucher {
  type: VoucherType;
  amount: number | null;
  date: Date | null;
  time: string | null;
  referenceNumber: string | null;
  senderName: string | null;
  senderAccount: string | null;
  recipientName: string | null;
  recipientAccount: string | null;
  bank: string | null;
  status: string | null;
  confidence: number;
  rawText: string;
  allAmounts: number[];
  validationErrors: string[];
}

/**
 * Voucher schema definition
 */
interface VoucherSchema {
  type: VoucherType;
  identifiers: RegExp[];  // Patterns to identify this voucher type
  patterns: {
    amount?: RegExp[];
    date?: RegExp[];
    time?: RegExp[];
    reference?: RegExp[];
    senderName?: RegExp[];
    senderAccount?: RegExp[];
    recipientName?: RegExp[];
    recipientAccount?: RegExp[];
    status?: RegExp[];
  };
  requiredFields: string[];
  amountRange?: { min: number; max: number };
}

@Injectable()
export class VoucherParserService {
  private readonly logger = new Logger(VoucherParserService.name);

  /**
   * Voucher schemas for different bank types
   * ORDER MATTERS - more specific schemas should come first
   */
  private readonly schemas: VoucherSchema[] = [
    // Nequi Schema (MUST be before Bancolombia to catch Nequi transfers to Bancolombia)
    {
      type: VoucherType.NEQUI,
      identifiers: [
        /nequi/i,
        /pago\s+exitoso/i,
        /envio\s+se\s+ha\s+realizado/i,
        /escanea\s+este\s+qr/i,
        /enviaste\s+plata/i,
        /recibiste\s+plata/i,
        /de\s+d[oó]nde\s+sali[oó]\s+la\s+plata/i,
      ],
      patterns: {
        amount: [
          /cu[aá]nto\??\s*\$?\s*([\d]{1,3}(?:\.[\d]{3})+(?:,\d{2})?)/i,
          /\$\s*([\d]{1,3}(?:\.[\d]{3})+(?:,\d{2})?)/,
          /enviaste[:\s]+\$?\s*([\d]{1,3}(?:[.,][\d]{3})+)/i,
          /recibiste[:\s]+\$?\s*([\d]{1,3}(?:[.,][\d]{3})+)/i,
        ],
        date: [
          // Match "13 De Enero De 2026" format (case insensitive for "De")
          /(\d{1,2})\s+[Dd]e\s+(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\s+[Dd]e\s+(\d{4})/i,
          /(\d{1,2})\s+(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)(?:\s+(?:de\s+)?(\d{4}))?/i,
          /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
        ],
        time: [
          /(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?))/i,
        ],
        reference: [
          /referencia\s+([A-Z0-9]+)/i,
          /(?:id|referencia)[:\s]*([A-Z0-9]+)/i,
        ],
        senderName: [
          /de\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+)/i,
        ],
        recipientName: [
          // Match masked names like "Est*** Gar✶✶✶ Mar***" directly (full name in one group)
          /([A-Z][a-z]*\*{2,}\s+[A-Z][a-z]*[\*✶]{2,}\s+[A-Z][a-z]*\*{2,})/i,
          // Match "Para" followed by name on next line
          /para\s*\n([A-Za-z\*✶]+\s+[A-Za-z\*✶]+(?:\s+[A-Za-z\*✶]+)?)/i,
          // Match masked names with special characters
          /para\s+([A-Za-z\*✶]+\s+[A-Za-z\*✶]+\s+[A-Za-z\*✶]+)/i,
          /para\s+([\w\*✶]+(?:\s+[\w\*✶]+)+)(?=\s*¿)/i,
          /(?:a|para)\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+)/i,
        ],
        recipientAccount: [
          /n[uú]mero\s+de\s+cuenta\s+(\d+)/i,
          /cuenta[:\s]*(\d+)/i,
        ],
        status: [
          /pago\s+(exitoso)/i,
          /envio\s+se\s+ha\s+realizado\s+con\s+([eé]xito)/i,
          /(exitoso|completado|enviado|recibido)/i,
        ],
      },
      requiredFields: ['amount'],
      amountRange: { min: 1000, max: 10000000 },
    },

    // Bancolombia Schema
    {
      type: VoucherType.BANCOLOMBIA,
      identifiers: [
        /bancolombia/i,
        /transferencia\s+exitosa/i,
        /transacci[oó]n\s+exitosa/i,
        /comprobante\s+no\./i,
        /comprobante\s+de\s+pago/i,
      ],
      patterns: {
        amount: [
          /\$\s*([\d]{1,3}(?:\.[\d]{3})+(?:,\d{2})?)/,
          /valor[:\s]+\$?\s*([\d]{1,3}(?:[.,][\d]{3})+)/i,
          /valor\s+de\s+la\s+transferencia[:\s]*\$?\s*([\d]{1,3}(?:[.,][\d]{3})+)/i,
          /monto[:\s]+\$?\s*([\d]{1,3}(?:[.,][\d]{3})+)/i,
          /total[:\s]+\$?\s*([\d]{1,3}(?:[.,][\d]{3})+)/i,
        ],
        date: [
          /(\d{1,2})\s*(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s*(\d{4})/i,
          /(\d{1,2})\s*(?:de\s*)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\s*(?:de\s*)?(\d{4})/i,
          /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
          /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
        ],
        time: [
          /(\d{1,2}:\d{2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?))/i,
          /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i,
          /hora[:\s]+(\d{1,2}:\d{2})/i,
        ],
        reference: [
          /comprobante\s+no\.?\s*(\d+)/i,
          /n[uú]mero\s+de\s+aprobaci[oó]n[:\s]*(\d+)/i,
          /referencia[:\s]*(\d+)/i,
          /No\.\s*(\d+)/i,
          /CUS[:\s]*(\d+)/i,
        ],
        senderName: [
          /producto\s+origen\s+([A-Za-záéíóúñÁÉÍÓÚÑ\s]+?)(?=\s+ahorros|\s+corriente|\n|\*)/i,
          /de[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+?)(?=\s+a\s+|\s+hacia\s+|\n)/i,
          /origen[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+)/i,
        ],
        recipientName: [
          /producto\s+destino\s+([A-Za-záéíóúñÁÉÍÓÚÑ\s]+?)(?=\s+ahorros|\s+corriente|\n)/i,
          /(?:a|hacia|para)[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+?)(?=\s+\d|\n|$)/i,
          /destino[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+)/i,
          /beneficiario[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+)/i,
        ],
        recipientAccount: [
          /producto\s+destino\s+[A-Za-záéíóúñÁÉÍÓÚÑ\s]+?(?:ahorros|corriente)\s+(\d{3}[^\d]+\d{5,6}[^\d]+\d{2})/i,
          /(\d{3}\s*[^\d\s]\s*\d{5,6}\s*[^\d\s]\s*\d{2})/,
          /(\d{3}[-–—‐‒―−]?\d{6}[-–—‐‒―−]?\d{2})/,
          /cuenta[:\s]*[#]*\s*(\d{4,})/i,
          /ahorros\s+(\d{3}\s*[^\d\s]\s*\d{5,6}\s*[^\d\s]\s*\d{2})/i,
          /corriente\s+(\d{3}\s*[^\d\s]\s*\d{5,6}\s*[^\d\s]\s*\d{2})/i,
        ],
        status: [
          /transferencia\s+(exitosa)/i,
          /transacci[oó]n\s+(exitosa)/i,
          /(exitosa|aprobada|completada|rechazada|pendiente)/i,
        ],
      },
      requiredFields: ['amount'],
      amountRange: { min: 1000, max: 50000000 },
    },
  ];

  // Configuration constants
  private readonly EXPECTED_DESTINATION_ACCOUNT = '33177135742';
  private readonly PAYMENT_DUE_DAY = 5;

  /**
   * Normalize account number by removing dashes, spaces, and other separators
   */
  private normalizeAccount(account: string): string {
    return account.replace(/[-\s.]/g, '');
  }

  /**
   * Validate if voucher type is accepted (only Nequi and Bancolombia)
   */
  isAcceptedVoucherType(type: VoucherType): boolean {
    return type === VoucherType.NEQUI || type === VoucherType.BANCOLOMBIA;
  }

  /**
   * Validate voucher and return validation issues
   * @param parsedVoucher - The parsed voucher data
   * @param expectedAmount - The expected payment amount
   * @param paymentMonth - The month the payment is for (1-12), optional
   * @param paymentYear - The year the payment is for, optional
   */
  validatePaymentVoucher(
    parsedVoucher: ParsedVoucher,
    expectedAmount: number,
    paymentMonth?: number,
    paymentYear?: number,
  ): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check voucher type
    if (!this.isAcceptedVoucherType(parsedVoucher.type)) {
      return { isValid: false, issues: ['Tipo de comprobante no aceptado. Solo se aceptan comprobantes de Nequi o Bancolombia.'] };
    }

    // Check amount match
    if (parsedVoucher.amount !== null && parsedVoucher.amount !== expectedAmount) {
      issues.push(`El monto del comprobante ($${parsedVoucher.amount.toLocaleString('es-CO')}) no coincide con la cuota esperada ($${expectedAmount.toLocaleString('es-CO')}).`);
    }

    // Check destination account (normalize both to compare without dashes/spaces)
    if (parsedVoucher.recipientAccount) {
      const account = this.normalizeAccount(parsedVoucher.recipientAccount);
      const expectedAccount = this.normalizeAccount(this.EXPECTED_DESTINATION_ACCOUNT);
      if (account !== expectedAccount) {
        issues.push(`La cuenta destino (${parsedVoucher.recipientAccount}) no coincide con la cuenta de la natillera (${this.EXPECTED_DESTINATION_ACCOUNT}).`);
      }
    } else {
      // If no destination account detected, it's a critical error
      issues.push(`No se pudo detectar la cuenta destino en el comprobante. Por seguridad, este pago requiere verificación manual.`);
    }

    // Validate voucher date against payment month
    // A payment for month X can be made with a voucher dated:
    // - Any day in month X, OR
    // - Day 1-5 of month X+1 (grace period)
    if (parsedVoucher.date && paymentMonth && paymentYear) {
      const voucherDate = parsedVoucher.date;
      const voucherMonth = voucherDate.getMonth() + 1; // 1-12
      const voucherYear = voucherDate.getFullYear();
      const voucherDay = voucherDate.getDate();

      // Calculate next month and year (for grace period)
      const nextMonth = paymentMonth === 12 ? 1 : paymentMonth + 1;
      const nextYear = paymentMonth === 12 ? paymentYear + 1 : paymentYear;

      const isInPaymentMonth = voucherMonth === paymentMonth && voucherYear === paymentYear;
      const isInGracePeriod = voucherMonth === nextMonth && voucherYear === nextYear && voucherDay <= this.PAYMENT_DUE_DAY;

      if (!isInPaymentMonth && !isInGracePeriod) {
        const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 
                          'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        
        if (voucherMonth === nextMonth && voucherYear === nextYear && voucherDay > this.PAYMENT_DUE_DAY) {
          issues.push(`El comprobante tiene fecha del ${voucherDay} de ${monthNames[voucherMonth]}, después del día ${this.PAYMENT_DUE_DAY} límite para pagos de ${monthNames[paymentMonth]}.`);
        } else {
          issues.push(`La fecha del comprobante (${voucherDay}/${voucherMonth}/${voucherYear}) no corresponde al mes de pago ${monthNames[paymentMonth]} ${paymentYear}.`);
        }
      }
    }

    return { isValid: issues.length === 0, issues };
  }

  /**
   * Parse voucher text and extract structured data
   */
  parseVoucher(rawText: string): ParsedVoucher {
    const normalizedText = this.normalizeText(rawText);
    
    // Detect voucher type
    const schema = this.detectVoucherType(normalizedText);
    
    // Extract all amounts first (used for fallback)
    const allAmounts = this.extractAllAmounts(normalizedText);
    
    // Parse fields based on schema
    const parsed: ParsedVoucher = {
      type: schema?.type || VoucherType.UNKNOWN,
      amount: null,
      date: null,
      time: null,
      referenceNumber: null,
      senderName: null,
      senderAccount: null,
      recipientName: null,
      recipientAccount: null,
      bank: schema?.type || null,
      status: null,
      confidence: 0,
      rawText,
      allAmounts,
      validationErrors: [],
    };

    if (schema) {
      // Extract amount
      parsed.amount = this.extractWithPatterns(normalizedText, schema.patterns.amount);
      if (parsed.amount === null && allAmounts.length > 0) {
        // Fallback to first detected amount in valid range
        const validAmounts = allAmounts.filter(
          a => (!schema.amountRange || (a >= schema.amountRange.min && a <= schema.amountRange.max))
        );
        parsed.amount = validAmounts[0] || allAmounts[0];
      }

      // Extract date
      const dateStr = this.extractStringWithPatterns(normalizedText, schema.patterns.date);
      if (dateStr) {
        parsed.date = this.parseDate(dateStr);
      }

      // Extract time
      parsed.time = this.extractStringWithPatterns(normalizedText, schema.patterns.time);

      // Extract reference number
      parsed.referenceNumber = this.extractStringWithPatterns(normalizedText, schema.patterns.reference);

      // Extract names
      parsed.senderName = this.extractStringWithPatterns(normalizedText, schema.patterns.senderName);
      parsed.recipientName = this.extractStringWithPatterns(normalizedText, schema.patterns.recipientName);

      // Extract accounts
      parsed.senderAccount = this.extractStringWithPatterns(normalizedText, schema.patterns.senderAccount);
      parsed.recipientAccount = this.extractStringWithPatterns(normalizedText, schema.patterns.recipientAccount);

      // Extract status
      parsed.status = this.extractStringWithPatterns(normalizedText, schema.patterns.status);

      // Validate required fields
      this.validateVoucher(parsed, schema);

      // Calculate confidence
      parsed.confidence = this.calculateConfidence(parsed, schema);
    } else {
      // Unknown voucher type - try generic extraction
      parsed.amount = allAmounts.length > 0 ? this.findMostLikelyAmount(allAmounts) : null;
      parsed.validationErrors.push('Unknown voucher type');
      parsed.confidence = parsed.amount ? 0.3 : 0;
    }

    this.logger.log(`Parsed voucher: type=${parsed.type}, amount=${parsed.amount}, confidence=${parsed.confidence}`);
    
    return parsed;
  }

  /**
   * Detect voucher type from text
   */
  private detectVoucherType(text: string): VoucherSchema | null {
    for (const schema of this.schemas) {
      for (const identifier of schema.identifiers) {
        if (identifier.test(text)) {
          this.logger.log(`Detected voucher type: ${schema.type}`);
          return schema;
        }
      }
    }
    return null;
  }

  /**
   * Normalize text for better matching
   */
  private normalizeText(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract numeric amount using patterns
   */
  private extractWithPatterns(text: string, patterns?: RegExp[]): number | null {
    if (!patterns) return null;

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const amount = this.parseAmount(match[1]);
        if (amount !== null) {
          return amount;
        }
      }
    }
    return null;
  }

  /**
   * Extract string using patterns
   */
  private extractStringWithPatterns(text: string, patterns?: RegExp[]): string | null {
    if (!patterns) return null;

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return null;
  }

  /**
   * Parse Colombian currency amount
   */
  private parseAmount(text: string): number | null {
    try {
      // Remove currency symbol and spaces
      let cleaned = text.replace(/[$\s]/g, '');
      
      // Handle Colombian format (dots as thousands, comma as decimal)
      if (cleaned.includes('.') && !cleaned.includes(',')) {
        cleaned = cleaned.replace(/\./g, '');
      } else if (cleaned.includes('.') && cleaned.includes(',')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else if (cleaned.includes(',')) {
        const parts = cleaned.split(',');
        if (parts[parts.length - 1].length <= 2) {
          cleaned = cleaned.replace(',', '.');
        } else {
          cleaned = cleaned.replace(/,/g, '');
        }
      }

      const amount = parseFloat(cleaned);
      return isNaN(amount) ? null : Math.round(amount);
    } catch {
      return null;
    }
  }

  /**
   * Extract all amounts from text
   */
  private extractAllAmounts(text: string): number[] {
    const amounts: number[] = [];
    const patterns = [
      /\$\s*([\d]{1,3}(?:\.[\d]{3})+(?:,\d{2})?)/g,
      /\$\s*([\d]{1,3}(?:,[\d]{3})+(?:\.\d{2})?)/g,
      /(?<!\d)([\d]{1,3}(?:[.,][\d]{3})+)(?:[,.][\d]{2})?(?!\d)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const amount = this.parseAmount(match[1]);
        if (amount !== null && amount >= 1000 && amount <= 100000000) {
          if (!amounts.includes(amount)) {
            amounts.push(amount);
          }
        }
      }
    }

    return amounts.sort((a, b) => b - a);
  }

  /**
   * Find the most likely payment amount
   */
  private findMostLikelyAmount(amounts: number[]): number | null {
    if (amounts.length === 0) return null;

    // Typical natillera range
    const typicalAmounts = amounts.filter(a => a >= 50000 && a <= 500000);
    if (typicalAmounts.length > 0) {
      return typicalAmounts[0];
    }

    return amounts[0];
  }

  /**
   * Parse date from various formats
   */
  private parseDate(dateStr: string): Date | null {
    const months: Record<string, number> = {
      ene: 0, enero: 0,
      feb: 1, febrero: 1,
      mar: 2, marzo: 2,
      abr: 3, abril: 3,
      may: 4, mayo: 4,
      jun: 5, junio: 5,
      jul: 6, julio: 6,
      ago: 7, agosto: 7,
      sep: 8, septiembre: 8,
      oct: 9, octubre: 9,
      nov: 10, noviembre: 10,
      dic: 11, diciembre: 11,
    };

    // Try Spanish month format: "22 de enero de 2026"
    const spanishMatch = dateStr.match(/(\d{1,2})\s*(?:de\s*)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\s*(?:de\s*)?(\d{4})?/i);
    if (spanishMatch) {
      const day = parseInt(spanishMatch[1], 10);
      const monthKey = spanishMatch[2].toLowerCase().substring(0, 3);
      const month = months[monthKey];
      const year = spanishMatch[3] ? parseInt(spanishMatch[3], 10) : new Date().getFullYear();
      if (month !== undefined) {
        return new Date(year, month, day);
      }
    }

    // Try DD/MM/YYYY or DD-MM-YYYY
    const slashMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const month = parseInt(slashMatch[2], 10) - 1;
      let year = parseInt(slashMatch[3], 10);
      if (year < 100) year += 2000;
      return new Date(year, month, day);
    }

    return null;
  }

  /**
   * Validate voucher against schema requirements
   */
  private validateVoucher(parsed: ParsedVoucher, schema: VoucherSchema): void {
    // Check required fields
    for (const field of schema.requiredFields) {
      if (parsed[field as keyof ParsedVoucher] === null) {
        parsed.validationErrors.push(`Missing required field: ${field}`);
      }
    }

    // Validate amount range
    if (parsed.amount !== null && schema.amountRange) {
      if (parsed.amount < schema.amountRange.min) {
        parsed.validationErrors.push(`Amount ${parsed.amount} is below minimum ${schema.amountRange.min}`);
      }
      if (parsed.amount > schema.amountRange.max) {
        parsed.validationErrors.push(`Amount ${parsed.amount} exceeds maximum ${schema.amountRange.max}`);
      }
    }
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(parsed: ParsedVoucher, schema: VoucherSchema): number {
    let score = 0;
    let maxScore = 0;

    // Type detection: 30%
    maxScore += 30;
    if (parsed.type !== VoucherType.UNKNOWN) {
      score += 30;
    }

    // Amount extraction: 30%
    maxScore += 30;
    if (parsed.amount !== null) {
      score += 30;
    }

    // Reference number: 15%
    maxScore += 15;
    if (parsed.referenceNumber) {
      score += 15;
    }

    // Date: 10%
    maxScore += 10;
    if (parsed.date) {
      score += 10;
    }

    // Names: 10%
    maxScore += 10;
    if (parsed.recipientName || parsed.senderName) {
      score += 10;
    }

    // No validation errors: 5%
    maxScore += 5;
    if (parsed.validationErrors.length === 0) {
      score += 5;
    }

    return Math.round((score / maxScore) * 100) / 100;
  }

  /**
   * Get all supported voucher types
   */
  getSupportedTypes(): VoucherType[] {
    return this.schemas.map(s => s.type);
  }

  /**
   * Add or update a voucher schema
   */
  addSchema(schema: VoucherSchema): void {
    const existingIndex = this.schemas.findIndex(s => s.type === schema.type);
    if (existingIndex >= 0) {
      this.schemas[existingIndex] = schema;
    } else {
      this.schemas.push(schema);
    }
  }
}
