import { Injectable, Logger } from '@nestjs/common';

export interface OcrResult {
  amount: number | null;
  rawText: string;
  confidence: number;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  /**
   * Extract payment amount from voucher image using OCR
   * This is a placeholder - you can integrate with:
   * - Google Cloud Vision API
   * - AWS Textract
   * - Azure Computer Vision
   * - Tesseract.js
   */
  async extractAmountFromImage(imageUrl: string): Promise<OcrResult> {
    this.logger.log(`Processing image for OCR: ${imageUrl}`);

    // TODO: Implement actual OCR integration
    // For now, return a placeholder that indicates manual verification is needed
    
    // Example integration with Google Cloud Vision:
    // const vision = require('@google-cloud/vision');
    // const client = new vision.ImageAnnotatorClient();
    // const [result] = await client.textDetection(imageUrl);
    // const detections = result.textAnnotations;
    // const rawText = detections[0]?.description || '';
    
    // Parse amount from text using regex patterns for Colombian currency
    // const amountPattern = /\$?\s*[\d.,]+/g;
    // const matches = rawText.match(amountPattern);

    return {
      amount: null, // null indicates OCR couldn't extract amount
      rawText: 'OCR not configured - manual verification required',
      confidence: 0,
    };
  }

  /**
   * Parse Colombian currency format to number
   * Examples: "$100.000", "100,000", "100.000,00"
   */
  parseColombianCurrency(text: string): number | null {
    try {
      // Remove currency symbol and spaces
      let cleaned = text.replace(/[$\s]/g, '');
      
      // Handle Colombian format (dots as thousands separator, comma as decimal)
      // Check if it's Colombian format (has dots but no comma, or comma is at the end)
      if (cleaned.includes('.') && !cleaned.includes(',')) {
        // Format like "100.000" -> 100000
        cleaned = cleaned.replace(/\./g, '');
      } else if (cleaned.includes('.') && cleaned.includes(',')) {
        // Format like "100.000,00" -> 100000.00
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else if (cleaned.includes(',')) {
        // Format like "100,000" (US format) or "100,00" (decimal)
        const commaIndex = cleaned.indexOf(',');
        const afterComma = cleaned.substring(commaIndex + 1);
        if (afterComma.length <= 2) {
          // Decimal comma
          cleaned = cleaned.replace(',', '.');
        } else {
          // Thousands comma
          cleaned = cleaned.replace(/,/g, '');
        }
      }

      const amount = parseFloat(cleaned);
      return isNaN(amount) ? null : amount;
    } catch {
      return null;
    }
  }
}
