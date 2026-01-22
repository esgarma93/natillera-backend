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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MongoPaymentRepository = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const payment_entity_1 = require("../../domain/payment.entity");
const payment_schema_1 = require("../schemas/payment.schema");
let MongoPaymentRepository = class MongoPaymentRepository {
    constructor(paymentModel) {
        this.paymentModel = paymentModel;
    }
    async findAll() {
        const payments = await this.paymentModel.find().sort({ paymentDate: -1 }).exec();
        return payments.map((doc) => this.toEntity(doc));
    }
    async findById(id) {
        const payment = await this.paymentModel.findById(id).exec();
        return payment ? this.toEntity(payment) : null;
    }
    async findByPartnerId(partnerId) {
        const payments = await this.paymentModel
            .find({ partnerId })
            .sort({ paymentDate: -1 })
            .exec();
        return payments.map((doc) => this.toEntity(doc));
    }
    async findByDateRange(startDate, endDate) {
        const payments = await this.paymentModel
            .find({
            paymentDate: { $gte: startDate, $lte: endDate },
        })
            .sort({ paymentDate: -1 })
            .exec();
        return payments.map((doc) => this.toEntity(doc));
    }
    async create(payment) {
        const created = new this.paymentModel(payment);
        const saved = await created.save();
        return this.toEntity(saved);
    }
    async update(id, payment) {
        const updated = await this.paymentModel
            .findByIdAndUpdate(id, { ...payment, updatedAt: new Date() }, { new: true })
            .exec();
        return updated ? this.toEntity(updated) : null;
    }
    async delete(id) {
        const result = await this.paymentModel.findByIdAndDelete(id).exec();
        return !!result;
    }
    toEntity(doc) {
        return new payment_entity_1.Payment({
            id: doc._id.toString(),
            partnerId: doc.partnerId,
            partnerName: doc.partnerName,
            paymentDate: doc.paymentDate,
            amount: doc.amount,
            expectedAmount: doc.expectedAmount,
            difference: doc.difference,
            status: doc.status,
            voucherImageUrl: doc.voucherImageUrl,
            whatsappMessageId: doc.whatsappMessageId,
            notes: doc.notes,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        });
    }
};
MongoPaymentRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(payment_schema_1.PaymentSchema.name)),
    __metadata("design:paramtypes", [mongoose_2.Model])
], MongoPaymentRepository);
exports.MongoPaymentRepository = MongoPaymentRepository;
//# sourceMappingURL=mongo-payment.repository.js.map