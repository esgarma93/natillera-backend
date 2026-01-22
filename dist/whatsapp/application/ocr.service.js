"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var OcrService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.OcrService = void 0;
const common_1 = require("@nestjs/common");
const vision_1 = require("@google-cloud/vision");
const axios_1 = require("axios");
let OcrService = OcrService_1 = class OcrService {
    constructor() {
        this.logger = new common_1.Logger(OcrService_1.name);
        this.visionClient = null;
        this.initializeVisionClient();
    }
    initializeVisionClient() {
        try {
            const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
            const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
            if (credentialsJson) {
                const credentials = JSON.parse(credentialsJson);
                this.visionClient = new vision_1.ImageAnnotatorClient({
                    credentials,
                    projectId: credentials.project_id,
                });
                this.logger.log('Google Cloud Vision initialized from environment credentials');
            }
            else if (credentialsPath) {
                this.visionClient = new vision_1.ImageAnnotatorClient({
                    keyFilename: credentialsPath,
                });
                this.logger.log('Google Cloud Vision initialized from credentials file');
            }
            else {
                this.logger.warn('Google Cloud Vision credentials not configured. OCR will be disabled.');
            }
        }
        catch (error) {
            this.logger.error('Failed to initialize Google Cloud Vision:', error);
        }
    }
    async extractAmountFromImage(imageUrl) {
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
            const imageBuffer = await this.downloadImage(imageUrl);
            if (!imageBuffer) {
                return {
                    amount: null,
                    rawText: 'Failed to download image',
                    confidence: 0,
                    allAmounts: [],
                };
            }
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
            const rawText = detections[0].description || '';
            this.logger.log(`OCR Raw Text: ${rawText.substring(0, 200)}...`);
            const allAmounts = this.extractAmountsFromText(rawText);
            this.logger.log(`Extracted amounts: ${allAmounts.join(', ')}`);
            const amount = this.findMostLikelyPaymentAmount(allAmounts);
            const confidence = amount !== null ? 0.85 : 0;
            return {
                amount,
                rawText,
                confidence,
                allAmounts,
            };
        }
        catch (error) {
            this.logger.error('Error performing OCR:', error);
            return {
                amount: null,
                rawText: `OCR error: ${error.message}`,
                confidence: 0,
                allAmounts: [],
            };
        }
    }
    async downloadImage(url) {
        try {
            const token = process.env.WHATSAPP_ACCESS_TOKEN;
            const response = await axios_1.default.get(url, {
                responseType: 'arraybuffer',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                timeout: 30000,
            });
            return Buffer.from(response.data);
        }
        catch (error) {
            this.logger.error('Error downloading image:', error);
            return null;
        }
    }
    extractAmountsFromText(text) {
        const amounts = [];
        const patterns = [
            /\$\s*([\d]{1,3}(?:\.[\d]{3})+)(?:[,.][\d]{2})?/g,
            /\$\s*([\d]{1,3}(?:,[\d]{3})+)(?:\.[\d]{2})?/g,
            /(?<!\d)([\d]{1,3}(?:[.,][\d]{3})+)(?:[,.][\d]{2})?(?!\d)/g,
            /(?<!\d)(\d{4,})(?!\d)/g,
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const parsed = this.parseColombianCurrency(match[1] || match[0]);
                if (parsed !== null && parsed >= 1000 && parsed <= 100000000) {
                    if (!amounts.includes(parsed)) {
                        amounts.push(parsed);
                    }
                }
            }
        }
        return amounts.sort((a, b) => b - a);
    }
    findMostLikelyPaymentAmount(amounts) {
        if (amounts.length === 0) {
            return null;
        }
        const minTypicalFee = 50000;
        const maxTypicalFee = 500000;
        const typicalAmounts = amounts.filter(a => a >= minTypicalFee && a <= maxTypicalFee);
        if (typicalAmounts.length > 0) {
            return typicalAmounts[0];
        }
        const broadAmounts = amounts.filter(a => a >= 10000 && a <= 1000000);
        if (broadAmounts.length > 0) {
            return broadAmounts[0];
        }
        return amounts[0];
    }
    parseColombianCurrency(text) {
        try {
            let cleaned = text.replace(/[$\s\w]/gi, '').trim();
            if (!cleaned) {
                return null;
            }
            const dots = (cleaned.match(/\./g) || []).length;
            const commas = (cleaned.match(/,/g) || []).length;
            if (dots > 0 && commas === 0) {
                const parts = cleaned.split('.');
                const lastPart = parts[parts.length - 1];
                if (lastPart.length === 3 || parts.length > 2) {
                    cleaned = cleaned.replace(/\./g, '');
                }
            }
            else if (commas > 0 && dots === 0) {
                const parts = cleaned.split(',');
                const lastPart = parts[parts.length - 1];
                if (lastPart.length === 3 || parts.length > 2) {
                    cleaned = cleaned.replace(/,/g, '');
                }
                else {
                    cleaned = cleaned.replace(',', '.');
                }
            }
            else if (dots > 0 && commas > 0) {
                cleaned = cleaned.replace(/\./g, '').replace(',', '.');
            }
            const amount = parseFloat(cleaned);
            return isNaN(amount) ? null : Math.round(amount);
        }
        catch {
            return null;
        }
    }
    async extractAmountFromBuffer(imageBuffer) {
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
        }
        catch (error) {
            this.logger.error('Error performing OCR on buffer:', error);
            return {
                amount: null,
                rawText: `OCR error: ${error.message}`,
                confidence: 0,
                allAmounts: [],
            };
        }
    }
};
OcrService = OcrService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], OcrService);
exports.OcrService = OcrService;
//# sourceMappingURL=ocr.service.js.map