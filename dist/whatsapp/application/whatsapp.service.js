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
var WhatsAppService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppService = void 0;
const common_1 = require("@nestjs/common");
const payments_service_1 = require("../../payments/application/payments.service");
const partners_service_1 = require("../../partners/application/partners.service");
const ocr_service_1 = require("./ocr.service");
const axios_1 = require("axios");
let WhatsAppService = WhatsAppService_1 = class WhatsAppService {
    constructor(paymentsService, partnersService, ocrService) {
        this.paymentsService = paymentsService;
        this.partnersService = partnersService;
        this.ocrService = ocrService;
        this.logger = new common_1.Logger(WhatsAppService_1.name);
        this.graphApiUrl = 'https://graph.facebook.com/v18.0';
    }
    verifyWebhook(mode, token, challenge) {
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (mode === 'subscribe' && token === verifyToken) {
            this.logger.log('Webhook verified successfully');
            return challenge;
        }
        this.logger.warn('Webhook verification failed');
        return null;
    }
    async processWebhook(body) {
        var _a, _b, _c, _d;
        try {
            const entry = (_a = body.entry) === null || _a === void 0 ? void 0 : _a[0];
            const changes = (_b = entry === null || entry === void 0 ? void 0 : entry.changes) === null || _b === void 0 ? void 0 : _b[0];
            const value = changes === null || changes === void 0 ? void 0 : changes.value;
            if (!((_c = value === null || value === void 0 ? void 0 : value.messages) === null || _c === void 0 ? void 0 : _c.length)) {
                this.logger.log('No messages in webhook payload');
                return;
            }
            const message = value.messages[0];
            const contact = (_d = value.contacts) === null || _d === void 0 ? void 0 : _d[0];
            const from = message.from;
            const messageId = message.id;
            this.logger.log(`Received message from ${from}, type: ${message.type}`);
            if (message.type === 'image') {
                await this.handleImageMessage(message, from, contact);
            }
            if (message.type === 'text') {
                await this.handleTextMessage(message, from);
            }
        }
        catch (error) {
            this.logger.error('Error processing webhook:', error);
        }
    }
    async handleImageMessage(message, from, contact) {
        var _a, _b, _c;
        const imageId = (_a = message.image) === null || _a === void 0 ? void 0 : _a.id;
        const caption = ((_b = message.image) === null || _b === void 0 ? void 0 : _b.caption) || '';
        const messageId = message.id;
        this.logger.log(`Processing image message. ID: ${imageId}, Caption: ${caption}`);
        try {
            const imageUrl = await this.getMediaUrl(imageId);
            if (!imageUrl) {
                await this.sendMessage(from, '❌ No se pudo procesar la imagen. Por favor intente de nuevo.');
                return;
            }
            const ocrResult = await this.ocrService.extractAmountFromImage(imageUrl);
            const raffleNumber = this.extractRaffleNumber(caption);
            const contactName = ((_c = contact === null || contact === void 0 ? void 0 : contact.profile) === null || _c === void 0 ? void 0 : _c.name) || caption.trim() || null;
            let partner = null;
            let partnerIdentifier = contactName || `WhatsApp: ${from}`;
            if (raffleNumber) {
                partner = await this.partnersService.findByNumeroRifa(raffleNumber);
                if (partner) {
                    partnerIdentifier = `${partner.nombre} (Rifa #${partner.numeroRifa})`;
                }
            }
            const currentMonth = new Date().getMonth() + 1;
            const currentYear = new Date().getFullYear();
            if (ocrResult.amount !== null) {
                if (partner) {
                    try {
                        await this.paymentsService.createFromWhatsApp(partner.id, ocrResult.amount, imageUrl, messageId);
                        this.logger.log(`Payment record created for partner: ${partner.nombre}`);
                        await this.sendMessage(from, `📸 ¡Comprobante de pago recibido!\n\n` +
                            `👤 Socio: ${partner.nombre}\n` +
                            `🎰 Rifa: #${partner.numeroRifa}\n` +
                            `💰 Monto detectado: $${ocrResult.amount.toLocaleString('es-CO')}\n` +
                            `💵 Cuota esperada: $${partner.montoCuota.toLocaleString('es-CO')}\n` +
                            `📅 Mes: ${this.getMonthName(currentMonth)} ${currentYear}\n\n` +
                            `✅ El pago ha sido registrado y será verificado pronto.\n` +
                            `Si hay algún error, por favor responda con el monto correcto.`);
                    }
                    catch (paymentError) {
                        this.logger.error('Error creating payment record:', paymentError);
                        await this.sendMessage(from, `📸 ¡Comprobante recibido pero hubo un error al registrar el pago.\n` +
                            `Por favor contacte al administrador.`);
                    }
                }
                else {
                    await this.sendMessage(from, `📸 ¡Comprobante de pago recibido!\n\n` +
                        `💰 Monto detectado: $${ocrResult.amount.toLocaleString('es-CO')}\n` +
                        `📅 Mes: ${this.getMonthName(currentMonth)} ${currentYear}\n\n` +
                        `${ocrResult.allAmounts.length > 1 ? `📊 Otros montos encontrados: ${ocrResult.allAmounts.filter(a => a !== ocrResult.amount).map(a => '$' + a.toLocaleString('es-CO')).join(', ')}\n\n` : ''}` +
                        `⚠️ No se encontró el número de rifa asociado.\n` +
                        `Por favor responda con su número de rifa (ej: "#5" o "Rifa 5")`);
                }
            }
            else {
                await this.sendMessage(from, `📸 ¡Comprobante de pago recibido!\n\n` +
                    `⚠️ No se pudo detectar automáticamente el monto del pago.\n\n` +
                    `Por favor responda con:\n` +
                    `1. Su número de rifa (ej: "#5")\n` +
                    `2. El monto del pago (ej: "150000")`);
            }
            this.logger.log(`Payment voucher received - From: ${from}, Partner: ${partnerIdentifier}, Image: ${imageId}, Caption: ${caption}, OCR Amount: ${ocrResult.amount}, All amounts: ${ocrResult.allAmounts.join(', ')}`);
        }
        catch (error) {
            this.logger.error('Error handling image message:', error);
            await this.sendMessage(from, '❌ Error procesando el comprobante de pago. Por favor intente de nuevo.');
        }
    }
    extractRaffleNumber(text) {
        const match = text.match(/#?(?:rifa\s*)?(\d+)/i);
        if (match) {
            const num = parseInt(match[1], 10);
            return isNaN(num) ? null : num;
        }
        return null;
    }
    getMonthName(month) {
        const months = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
        ];
        return months[month - 1] || 'Desconocido';
    }
    async handleTextMessage(message, from) {
        var _a;
        const text = ((_a = message.text) === null || _a === void 0 ? void 0 : _a.body) || '';
        this.logger.log(`Text message from ${from}: ${text}`);
        const amount = this.ocrService.parseColombianCurrency(text);
        if (amount !== null) {
            await this.sendMessage(from, `✅ Amount confirmed: $${amount.toLocaleString()}\n\n` +
                `Please send the payment voucher image to complete the registration.`);
        }
        else {
            await this.sendMessage(from, `👋 Hello! I'm the Natillera payment assistant.\n\n` +
                `To register a payment, please send:\n` +
                `📸 A photo of your payment voucher\n\n` +
                `You can include your name or raffle number in the caption.`);
        }
    }
    async getMediaUrl(mediaId) {
        var _a;
        try {
            const token = process.env.WHATSAPP_ACCESS_TOKEN;
            const response = await axios_1.default.get(`${this.graphApiUrl}/${mediaId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return ((_a = response.data) === null || _a === void 0 ? void 0 : _a.url) || null;
        }
        catch (error) {
            this.logger.error('Error getting media URL:', error);
            return null;
        }
    }
    async sendMessage(to, text) {
        try {
            const token = process.env.WHATSAPP_ACCESS_TOKEN;
            const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
            await axios_1.default.post(`${this.graphApiUrl}/${phoneNumberId}/messages`, {
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: text },
            }, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            this.logger.log(`Message sent to ${to}`);
        }
        catch (error) {
            this.logger.error('Error sending message:', error);
        }
    }
};
WhatsAppService = WhatsAppService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [payments_service_1.PaymentsService,
        partners_service_1.PartnersService,
        ocr_service_1.OcrService])
], WhatsAppService);
exports.WhatsAppService = WhatsAppService;
//# sourceMappingURL=whatsapp.service.js.map