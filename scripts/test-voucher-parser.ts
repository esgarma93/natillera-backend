/**
 * Test script for Voucher Schema Validation
 * 
 * Usage:
 * npx ts-node scripts/test-voucher-parser.ts <image-path>
 * npx ts-node scripts/test-voucher-parser.ts resources/comprobanteBancolombia.jpeg
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ImageAnnotatorClient } from '@google-cloud/vision';
import * as fs from 'fs';
import * as path from 'path';

// Import the voucher parser (we'll inline a simplified version for testing)
enum VoucherType {
  BANCOLOMBIA = 'bancolombia',
  NEQUI = 'nequi',
  UNKNOWN = 'unknown',
}

interface ParsedVoucher {
  type: VoucherType;
  amount: number | null;
  date: Date | null;
  time: string | null;
  referenceNumber: string | null;
  senderName: string | null;
  recipientName: string | null;
  recipientAccount: string | null;
  status: string | null;
  confidence: number;
  allAmounts: number[];
  validationErrors: string[];
}

interface VoucherSchema {
  type: VoucherType;
  identifiers: RegExp[];
  patterns: {
    amount?: RegExp[];
    date?: RegExp[];
    time?: RegExp[];
    reference?: RegExp[];
    senderName?: RegExp[];
    recipientName?: RegExp[];
    recipientAccount?: RegExp[];
    status?: RegExp[];
  };
  requiredFields: string[];
  amountRange?: { min: number; max: number };
}

// Voucher schemas (ORDER MATTERS - more specific schemas should come first)
const schemas: VoucherSchema[] = [
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
        /(\d{1,2})\s+de\s+(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\s+de\s+(\d{4})/i,
        /fecha\s+(\d{1,2})\s+(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\s+(?:de\s+)?(\d{4})/i,
      ],
      time: [
        /(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?))/i,
      ],
      reference: [
        /referencia\s+([A-Z0-9]+)/i,
        /(?:id|referencia)[:\s]*([A-Z0-9]+)/i,
      ],
      recipientName: [
        // Match masked names like "Est*** Gar✶✶✶ Mar***" directly (full name in one group)
        /([A-Z][a-z]*\*{2,}\s+[A-Z][a-z]*[\*✶]{2,}\s+[A-Z][a-z]*\*{2,})/i,
        // Match "Para" followed by name on next line
        /para\s*\n([A-Za-z\*✶]+\s+[A-Za-z\*✶]+(?:\s+[A-Za-z\*✶]+)?)/i,
        // Match masked names like "Est*** Gar✶✶✶ Mar***" with special characters
        /para\s+([A-Za-z\*✶]+\s+[A-Za-z\*✶]+\s+[A-Za-z\*✶]+)/i,
        /para\s+([\w\*✶]+(?:\s+[\w\*✶]+)+)(?=\s*¿)/i,
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
      ],
      recipientName: [
        /producto\s+destino\s+([A-Za-záéíóúñÁÉÍÓÚÑ\s]+?)(?=\s+ahorros|\s+corriente|\n)/i,
        /(?:a|hacia|para)[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+?)(?=\s+\d|\n|$)/i,
        /destino[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+)/i,
        /beneficiario[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+)/i,
      ],
      recipientAccount: [
        /(\d{3}[-]?\d{6}[-]?\d{2})/,
        /cuenta[:\s]*[#]*\s*(\d{4,})/i,
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
const EXPECTED_DESTINATION_ACCOUNT = '33177135742';
const PAYMENT_DUE_DAY = 5;

// Helper function to normalize account numbers
function normalizeAccount(account: string): string {
  return account.replace(/[-\s.]/g, '');
}

// Helper functions for validation
function isAcceptedVoucherType(type: VoucherType): boolean {
  return type === VoucherType.NEQUI || type === VoucherType.BANCOLOMBIA;
}

function validatePaymentVoucher(
  parsedVoucher: ParsedVoucher,
  expectedAmount: number,
): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check voucher type
  if (!isAcceptedVoucherType(parsedVoucher.type)) {
    return { isValid: false, issues: ['Tipo de comprobante no aceptado. Solo se aceptan comprobantes de Nequi o Bancolombia.'] };
  }

  // Check amount match
  if (parsedVoucher.amount !== null && parsedVoucher.amount !== expectedAmount) {
    issues.push(`El monto del comprobante ($${parsedVoucher.amount.toLocaleString('es-CO')}) no coincide con la cuota esperada ($${expectedAmount.toLocaleString('es-CO')}).`);
  }

  // Check destination account (normalize both to compare without dashes/spaces)
  if (parsedVoucher.recipientAccount) {
    const account = normalizeAccount(parsedVoucher.recipientAccount);
    const expectedAccount = normalizeAccount(EXPECTED_DESTINATION_ACCOUNT);
    if (account !== expectedAccount) {
      issues.push(`La cuenta destino (${parsedVoucher.recipientAccount}) no coincide con la cuenta de la natillera (${EXPECTED_DESTINATION_ACCOUNT}).`);
    }
  }

  // Check payment date (must be before 5th of the month)
  if (parsedVoucher.date) {
    const voucherDay = parsedVoucher.date.getDate();
    if (voucherDay > PAYMENT_DUE_DAY) {
      issues.push(`El comprobante tiene fecha del día ${voucherDay}, después del día ${PAYMENT_DUE_DAY} límite de pago.`);
    }
  }

  return { isValid: issues.length === 0, issues };
}

function parseAmount(text: string): number | null {
  try {
    let cleaned = text.replace(/[$\s]/g, '');
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

function extractAllAmounts(text: string): number[] {
  const amounts: number[] = [];
  const patterns = [
    /\$\s*([\d]{1,3}(?:\.[\d]{3})+(?:,\d{2})?)/g,
    /\$\s*([\d]{1,3}(?:,[\d]{3})+(?:\.\d{2})?)/g,
    /(?<!\d)([\d]{1,3}(?:[.,][\d]{3})+)(?:[,.][\d]{2})?(?!\d)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const amount = parseAmount(match[1]);
      if (amount !== null && amount >= 1000 && amount <= 100000000) {
        if (!amounts.includes(amount)) {
          amounts.push(amount);
        }
      }
    }
  }

  return amounts.sort((a, b) => b - a);
}

function detectVoucherType(text: string): VoucherSchema | null {
  for (const schema of schemas) {
    for (const identifier of schema.identifiers) {
      if (identifier.test(text)) {
        return schema;
      }
    }
  }
  return null;
}

function extractWithPatterns(text: string, patterns?: RegExp[]): number | null {
  if (!patterns) return null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return parseAmount(match[1]);
    }
  }
  return null;
}

function extractStringWithPatterns(text: string, patterns?: RegExp[]): string | null {
  if (!patterns) return null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function parseDate(text: string): Date | null {
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

  // Try "13 De Enero De 2026" or "21 Enero 2026" format (full or short month names)
  const fullMatch = text.match(/(\d{1,2})\s+(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\s+(?:de\s+)?(\d{4})/i);
  if (fullMatch) {
    const day = parseInt(fullMatch[1], 10);
    const monthStr = fullMatch[2].toLowerCase();
    // Map full names to short names for lookup
    const shortMonth = monthStr.substring(0, 3);
    const month = months[shortMonth];
    const year = parseInt(fullMatch[3], 10);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  // Try "21 Ene 2026" format
  const shortMatch = text.match(/(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\s+(\d{4})/i);
  if (shortMatch) {
    const day = parseInt(shortMatch[1], 10);
    const month = months[shortMatch[2].toLowerCase()];
    const year = parseInt(shortMatch[3], 10);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  // Try DD/MM/YYYY
  const slashMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const month = parseInt(slashMatch[2], 10) - 1;
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  return null;
}

function parseVoucher(rawText: string): ParsedVoucher {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  const schema = detectVoucherType(text);
  const allAmounts = extractAllAmounts(text);

  const parsed: ParsedVoucher = {
    type: schema?.type || VoucherType.UNKNOWN,
    amount: null,
    date: null,
    time: null,
    referenceNumber: null,
    senderName: null,
    recipientName: null,
    recipientAccount: null,
    status: null,
    confidence: 0,
    allAmounts,
    validationErrors: [],
  };

  if (schema) {
    parsed.amount = extractWithPatterns(text, schema.patterns.amount);
    if (parsed.amount === null && allAmounts.length > 0) {
      parsed.amount = allAmounts[0];
    }

    // Extract and parse date
    const dateStr = extractStringWithPatterns(text, schema.patterns.date);
    if (dateStr) {
      parsed.date = parseDate(dateStr);
    }
    // Also try to parse date directly from the text if patterns didn't work
    if (!parsed.date) {
      parsed.date = parseDate(text);
    }

    parsed.time = extractStringWithPatterns(text, schema.patterns.time);
    parsed.referenceNumber = extractStringWithPatterns(text, schema.patterns.reference);
    parsed.senderName = extractStringWithPatterns(text, schema.patterns.senderName);
    parsed.recipientName = extractStringWithPatterns(text, schema.patterns.recipientName);
    parsed.recipientAccount = extractStringWithPatterns(text, schema.patterns.recipientAccount);
    parsed.status = extractStringWithPatterns(text, schema.patterns.status);

    // Validate
    for (const field of schema.requiredFields) {
      if (parsed[field as keyof ParsedVoucher] === null) {
        parsed.validationErrors.push(`Missing: ${field}`);
      }
    }

    if (parsed.amount && schema.amountRange) {
      if (parsed.amount < schema.amountRange.min || parsed.amount > schema.amountRange.max) {
        parsed.validationErrors.push(`Amount out of range`);
      }
    }

    // Calculate confidence
    let score = 0;
    if (parsed.type !== VoucherType.UNKNOWN) score += 30;
    if (parsed.amount !== null) score += 30;
    if (parsed.referenceNumber) score += 15;
    if (parsed.time) score += 10;
    if (parsed.recipientName || parsed.senderName) score += 10;
    if (parsed.validationErrors.length === 0) score += 5;
    parsed.confidence = score / 100;
  } else {
    parsed.amount = allAmounts.length > 0 ? allAmounts[0] : null;
    parsed.validationErrors.push('Unknown voucher type');
    parsed.confidence = parsed.amount ? 0.3 : 0;
  }

  return parsed;
}

async function testVoucherParser() {
  console.log('🧾 Voucher Schema Parser Test\n');
  console.log('═'.repeat(60) + '\n');

  // Check credentials
  const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
  if (!credentialsJson) {
    console.error('❌ GOOGLE_CLOUD_CREDENTIALS not set');
    process.exit(1);
  }

  // Initialize Vision client
  const credentials = JSON.parse(credentialsJson);
  const client = new ImageAnnotatorClient({
    credentials,
    projectId: credentials.project_id,
  });

  // Get image path from args
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.log('Usage: npx ts-node scripts/test-voucher-parser.ts <image-path>\n');
    console.log('Supported voucher types:');
    schemas.forEach(s => {
      console.log(`  • ${s.type.toUpperCase()}`);
      console.log(`    Identifiers: ${s.identifiers.map(i => i.source).join(', ')}`);
    });
    process.exit(0);
  }

  const fullPath = path.resolve(imagePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`📸 Processing: ${path.basename(fullPath)}\n`);

  // Perform OCR
  const imageContent = fs.readFileSync(fullPath);
  const [result] = await client.textDetection({ image: { content: imageContent } });
  const detections = result.textAnnotations;

  if (!detections || detections.length === 0) {
    console.log('❌ No text detected in image');
    process.exit(1);
  }

  const rawText = detections[0].description || '';
  
  console.log('📝 RAW TEXT FROM OCR:');
  console.log('─'.repeat(60));
  console.log(rawText);
  console.log('─'.repeat(60) + '\n');

  // Parse voucher
  const parsed = parseVoucher(rawText);

  // Display results
  console.log('🔍 PARSED VOUCHER DATA:');
  console.log('─'.repeat(60));
  
  const typeEmoji = {
    [VoucherType.BANCOLOMBIA]: '🏦',
    [VoucherType.NEQUI]: '💜',
    [VoucherType.UNKNOWN]: '❓',
  };

  console.log(`${typeEmoji[parsed.type]} Type:            ${parsed.type.toUpperCase()}`);
  console.log(`💰 Amount:          ${parsed.amount ? '$' + parsed.amount.toLocaleString('es-CO') : 'Not detected'}`);
  console.log(`📅 Date:            ${parsed.date ? parsed.date.toLocaleDateString('es-CO') : 'Not detected'}`);
  console.log(`🕐 Time:            ${parsed.time || 'Not detected'}`);
  console.log(`🔢 Reference:       ${parsed.referenceNumber || 'Not detected'}`);
  console.log(`👤 Sender:          ${parsed.senderName || 'Not detected'}`);
  console.log(`👤 Recipient:       ${parsed.recipientName || 'Not detected'}`);
  console.log(`🏧 Account:         ${parsed.recipientAccount || 'Not detected'}`);
  console.log(`✅ Status:          ${parsed.status || 'Not detected'}`);
  console.log(`📊 Confidence:      ${(parsed.confidence * 100).toFixed(0)}%`);

  // Validate voucher
  console.log('─'.repeat(60));
  console.log('');
  console.log('🔒 VALIDATION (Example with expected amount = $50,000):');
  console.log('─'.repeat(60));
  
  const validation = validatePaymentVoucher(parsed, 50000);
  
  if (!isAcceptedVoucherType(parsed.type)) {
    console.log('❌ RECHAZADO: Tipo de comprobante no aceptado');
  } else if (validation.issues.length === 0) {
    console.log('✅ VERIFICADO: Todas las validaciones pasaron');
  } else {
    console.log('⚠️  PENDIENTE: Requiere revisión manual');
    console.log('');
    console.log('Observaciones:');
    validation.issues.forEach(issue => console.log(`  • ${issue}`));
  }
  
  if (parsed.allAmounts.length > 1) {
    console.log(`💵 All amounts:     ${parsed.allAmounts.map(a => '$' + a.toLocaleString('es-CO')).join(', ')}`);
  }

  console.log('─'.repeat(60));

  if (parsed.validationErrors.length > 0) {
    console.log('\n⚠️  VALIDATION ISSUES:');
    parsed.validationErrors.forEach(err => console.log(`   • ${err}`));
  } else {
    console.log('\n✅ Voucher validated successfully!');
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  if (parsed.confidence >= 0.7) {
    console.log('🎉 HIGH CONFIDENCE - Ready for automatic processing');
  } else if (parsed.confidence >= 0.4) {
    console.log('⚠️  MEDIUM CONFIDENCE - May need manual review');
  } else {
    console.log('❌ LOW CONFIDENCE - Manual verification required');
  }
}

testVoucherParser().catch(console.error);
