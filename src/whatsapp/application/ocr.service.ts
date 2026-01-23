import { Injectable, Logger } from '@nestjs/common';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import axios from 'axios';

export interface OcrResult {
  amount: number | null;
  rawText: string;
  confidence: number;
  allAmounts: number[];
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private visionClient: ImageAnnotatorClient | null = null;

  constructor() {
    this.initializeVisionClient();
  }

  /**
   * Initialize Google Cloud Vision client
   * Supports both credentials file and JSON string from environment variable
   */
  private initializeVisionClient(): void {
    try {
      const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

      if (credentialsJson) {
        // Parse credentials from environment variable (for Railway/cloud deployment)
        const credentials = JSON.parse(credentialsJson);
        this.visionClient = new ImageAnnotatorClient({
          credentials,
          projectId: credentials.project_id,
        });
        this.logger.log('Google Cloud Vision initialized from environment credentials');
      } else if (credentialsPath) {
        // Use credentials file path (for local development)
        this.visionClient = new ImageAnnotatorClient({
          keyFilename: credentialsPath,
        });
        this.logger.log('Google Cloud Vision initialized from credentials file');
      } else {
        this.logger.warn('Google Cloud Vision credentials not configured. OCR will be disabled.');
      }
    } catch (error) {
      this.logger.error('Failed to initialize Google Cloud Vision:', error);
    }
  }

  /**
   * Extract payment amount from voucher image using Google Cloud Vision OCR
   */
  async extractAmountFromImage(imageUrl: string): Promise<OcrResult> {
    this.logger.log(`Processing image for OCR: ${imageUrl}`);

    if (!this.visionClient) {
      this.logger.warn('Vision client not initialized, returning empty result');
      return {
        amount: null,
        rawText: 'OCR not configured - Google Cloud Vision credentials missing',
        confidence: 0,
        allAmounts: [],
      };
    }

    try {
      // Download image from URL
      const imageBuffer = await this.downloadImage(imageUrl);

      if (!imageBuffer) {
        return {
          amount: null,
          rawText: 'Failed to download image',
          confidence: 0,
          allAmounts: [],
        };
      }

      return this.processImageBuffer(imageBuffer);
    } catch (error) {
      this.logger.error('Error performing OCR:', error);
      return {
        amount: null,
        rawText: `OCR error: ${error.message}`,
        confidence: 0,
        allAmounts: [],
      };
    }
  }

  /**
   * Extract payment amount from base64 encoded image
   */
  async extractAmountFromBase64(base64Image: string): Promise<OcrResult> {
    this.logger.log('Processing base64 image for OCR');

    if (!this.visionClient) {
      this.logger.warn('Vision client not initialized, returning empty result');
      return {
        amount: null,
        rawText: 'OCR not configured - Google Cloud Vision credentials missing',
        confidence: 0,
        allAmounts: [],
      };
    }

    try {
      // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
      const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      return this.processImageBuffer(imageBuffer);
    } catch (error) {
      this.logger.error('Error performing OCR on base64 image:', error);
      return {
        amount: null,
        rawText: `OCR error: ${error.message}`,
        confidence: 0,
        allAmounts: [],
      };
    }
  }

  /**
   * Process image buffer with OCR
   */
  private async processImageBuffer(imageBuffer: Buffer): Promise<OcrResult> {
    // Perform OCR using Google Cloud Vision
    const [result] = await this.visionClient.textDetection({
      image: { content: imageBuffer },
    });

    const detections = result.textAnnotations;
    
    if (!detections || detections.length === 0) {
      this.logger.log('No text detected in image');
      return {
        amount: null,
        rawText: 'No text detected in image',
        confidence: 0,
        allAmounts: [],
      };
    }

    // First detection contains all text
    const rawText = detections[0].description || '';
    this.logger.log(`OCR Raw Text: ${rawText.substring(0, 200)}...`);

    // Extract all amounts from text
    const allAmounts = this.extractAmountsFromText(rawText);
    this.logger.log(`Extracted amounts: ${allAmounts.join(', ')}`);

    // Find the most likely payment amount
    const amount = this.findMostLikelyPaymentAmount(allAmounts);
    
    // Calculate confidence based on amount detection
    const confidence = amount !== null ? 0.85 : 0;

    return {
      amount,
      rawText,
      confidence,
      allAmounts,
    };
  }

  /**
   * Download image from URL and return as Buffer
   */
  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      // For WhatsApp media, we need to use the access token
      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        timeout: 30000,
      });

      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error('Error downloading image:', error);
      return null;
    }
  }

  /**
   * Extract all currency amounts from text
   * Supports various Colombian and international formats
   */
  private extractAmountsFromText(text: string): number[] {
    const amounts: number[] = [];
    
    // Patterns for Colombian currency (thousands separator: dot or comma)
    const patterns = [
      // $100.000 or $ 100.000 (Colombian format with dots)
      /\$\s*([\d]{1,3}(?:\.[\d]{3})+)(?:[,.][\d]{2})?/g,
      // $100,000 or $ 100,000 (US format with commas)
      /\$\s*([\d]{1,3}(?:,[\d]{3})+)(?:\.[\d]{2})?/g,
      // 100.000 or 100,000 (without currency symbol, 4+ digits)
      /(?<!\d)([\d]{1,3}(?:[.,][\d]{3})+)(?:[,.][\d]{2})?(?!\d)/g,
      // Simple numbers with 4+ digits (e.g., 150000)
      /(?<!\d)(\d{4,})(?!\d)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const parsed = this.parseColombianCurrency(match[1] || match[0]);
        if (parsed !== null && parsed >= 1000 && parsed <= 100000000) {
          // Only consider amounts between 1,000 and 100,000,000
          if (!amounts.includes(parsed)) {
            amounts.push(parsed);
          }
        }
      }
    }

    // Sort by value descending
    return amounts.sort((a, b) => b - a);
  }

  /**
   * Find the most likely payment amount from extracted amounts
   * Typically looking for amounts in the range of typical natillera fees
   */
  private findMostLikelyPaymentAmount(amounts: number[]): number | null {
    if (amounts.length === 0) {
      return null;
    }

    // Typical natillera fee range (adjust based on your use case)
    const minTypicalFee = 50000;   // 50,000 COP
    const maxTypicalFee = 500000;  // 500,000 COP

    // First, try to find an amount in the typical fee range
    const typicalAmounts = amounts.filter(a => a >= minTypicalFee && a <= maxTypicalFee);
    
    if (typicalAmounts.length > 0) {
      // Return the largest amount in typical range (often the total)
      return typicalAmounts[0];
    }

    // If no typical amounts found, try broader range
    const broadAmounts = amounts.filter(a => a >= 10000 && a <= 1000000);
    
    if (broadAmounts.length > 0) {
      return broadAmounts[0];
    }

    // Return largest amount as fallback
    return amounts[0];
  }

  /**
   * Parse Colombian currency format to number
   * Handles: "$100.000", "100,000", "100.000,00", "150000"
   */
  parseColombianCurrency(text: string): number | null {
    try {
      // Remove currency symbol, spaces, and letters
      let cleaned = text.replace(/[$\s\w]/gi, '').trim();
      
      if (!cleaned) {
        return null;
      }

      // Count dots and commas
      const dots = (cleaned.match(/\./g) || []).length;
      const commas = (cleaned.match(/,/g) || []).length;

      // Determine format and parse
      if (dots > 0 && commas === 0) {
        // Format: 100.000 (Colombian) or 100.00 (decimal)
        // Check if dots are used as thousands separator (every 3 digits)
        const parts = cleaned.split('.');
        const lastPart = parts[parts.length - 1];
        
        if (lastPart.length === 3 || parts.length > 2) {
          // Thousands separator (Colombian): 100.000 -> 100000
          cleaned = cleaned.replace(/\./g, '');
        }
        // Otherwise, it's a decimal point: 100.00 -> 100.00
      } else if (commas > 0 && dots === 0) {
        // Format: 100,000 or 100,00
        const parts = cleaned.split(',');
        const lastPart = parts[parts.length - 1];
        
        if (lastPart.length === 3 || parts.length > 2) {
          // Thousands separator: 100,000 -> 100000
          cleaned = cleaned.replace(/,/g, '');
        } else {
          // Decimal comma: 100,00 -> 100.00
          cleaned = cleaned.replace(',', '.');
        }
      } else if (dots > 0 && commas > 0) {
        // Mixed format: 100.000,00 (European/Colombian)
        // Dots are thousands, comma is decimal
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      }

      const amount = parseFloat(cleaned);
      return isNaN(amount) ? null : Math.round(amount);
    } catch {
      return null;
    }
  }

  /**
   * Extract amount from image buffer directly (for uploaded files)
   */
  async extractAmountFromBuffer(imageBuffer: Buffer): Promise<OcrResult> {
    if (!this.visionClient) {
      return {
        amount: null,
        rawText: 'OCR not configured',
        confidence: 0,
        allAmounts: [],
      };
    }

    try {
      const [result] = await this.visionClient.textDetection({
        image: { content: imageBuffer },
      });

      const detections = result.textAnnotations;
      
      if (!detections || detections.length === 0) {
        return {
          amount: null,
          rawText: 'No text detected',
          confidence: 0,
          allAmounts: [],
        };
      }

      const rawText = detections[0].description || '';
      const allAmounts = this.extractAmountsFromText(rawText);
      const amount = this.findMostLikelyPaymentAmount(allAmounts);

      return {
        amount,
        rawText,
        confidence: amount !== null ? 0.85 : 0,
        allAmounts,
      };
    } catch (error) {
      this.logger.error('Error performing OCR on buffer:', error);
      return {
        amount: null,
        rawText: `OCR error: ${error.message}`,
        confidence: 0,
        allAmounts: [],
      };
    }
  }
}
