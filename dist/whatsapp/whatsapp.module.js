"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppModule = void 0;
const common_1 = require("@nestjs/common");
const whatsapp_controller_1 = require("./presentation/whatsapp.controller");
const whatsapp_service_1 = require("./application/whatsapp.service");
const ocr_service_1 = require("./application/ocr.service");
const payments_module_1 = require("../payments/payments.module");
const partners_module_1 = require("../partners/partners.module");
let WhatsAppModule = class WhatsAppModule {
};
WhatsAppModule = __decorate([
    (0, common_1.Module)({
        imports: [payments_module_1.PaymentsModule, partners_module_1.PartnersModule],
        controllers: [whatsapp_controller_1.WhatsAppController],
        providers: [whatsapp_service_1.WhatsAppService, ocr_service_1.OcrService],
        exports: [whatsapp_service_1.WhatsAppService],
    })
], WhatsAppModule);
exports.WhatsAppModule = WhatsAppModule;
//# sourceMappingURL=whatsapp.module.js.map