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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppWebhookDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
class WhatsAppMessageMedia {
}
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppMessageMedia.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppMessageMedia.prototype, "mime_type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppMessageMedia.prototype, "sha256", void 0);
class WhatsAppMessage {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppMessage.prototype, "from", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppMessage.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppMessage.prototype, "timestamp", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppMessage.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], WhatsAppMessage.prototype, "text", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => WhatsAppMessageMedia),
    __metadata("design:type", WhatsAppMessageMedia)
], WhatsAppMessage.prototype, "image", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppMessage.prototype, "caption", void 0);
class WhatsAppContact {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppContact.prototype, "wa_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], WhatsAppContact.prototype, "profile", void 0);
class WhatsAppValue {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppValue.prototype, "messaging_product", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => WhatsAppMessage),
    __metadata("design:type", Array)
], WhatsAppValue.prototype, "messages", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => WhatsAppContact),
    __metadata("design:type", Array)
], WhatsAppValue.prototype, "contacts", void 0);
class WhatsAppChange {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppChange.prototype, "field", void 0);
__decorate([
    (0, class_validator_1.ValidateNested)(),
    (0, class_transformer_1.Type)(() => WhatsAppValue),
    __metadata("design:type", WhatsAppValue)
], WhatsAppChange.prototype, "value", void 0);
class WhatsAppEntry {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppEntry.prototype, "id", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => WhatsAppChange),
    __metadata("design:type", Array)
], WhatsAppEntry.prototype, "changes", void 0);
class WhatsAppWebhookDto {
}
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], WhatsAppWebhookDto.prototype, "object", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => WhatsAppEntry),
    __metadata("design:type", Array)
], WhatsAppWebhookDto.prototype, "entry", void 0);
exports.WhatsAppWebhookDto = WhatsAppWebhookDto;
//# sourceMappingURL=whatsapp-webhook.dto.js.map