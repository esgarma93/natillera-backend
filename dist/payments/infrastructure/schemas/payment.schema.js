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
exports.PaymentSchemaFactory = exports.PaymentSchema = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const payment_entity_1 = require("../../domain/payment.entity");
let PaymentSchema = class PaymentSchema {
};
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], PaymentSchema.prototype, "partnerId", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], PaymentSchema.prototype, "partnerName", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", Date)
], PaymentSchema.prototype, "paymentDate", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", Number)
], PaymentSchema.prototype, "amount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", Number)
], PaymentSchema.prototype, "expectedAmount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", Number)
], PaymentSchema.prototype, "difference", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true, enum: payment_entity_1.PaymentStatus, default: payment_entity_1.PaymentStatus.PENDING }),
    __metadata("design:type", String)
], PaymentSchema.prototype, "status", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], PaymentSchema.prototype, "voucherImageUrl", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], PaymentSchema.prototype, "whatsappMessageId", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], PaymentSchema.prototype, "notes", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", Date)
], PaymentSchema.prototype, "createdAt", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", Date)
], PaymentSchema.prototype, "updatedAt", void 0);
PaymentSchema = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true, collection: 'payments' })
], PaymentSchema);
exports.PaymentSchema = PaymentSchema;
exports.PaymentSchemaFactory = mongoose_1.SchemaFactory.createForClass(PaymentSchema);
//# sourceMappingURL=payment.schema.js.map