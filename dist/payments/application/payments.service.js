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
exports.PaymentsService = void 0;
const common_1 = require("@nestjs/common");
const payment_entity_1 = require("../domain/payment.entity");
const partner_repository_1 = require("../../partners/domain/partner.repository");
let PaymentsService = class PaymentsService {
    constructor(paymentRepository, partnerRepository) {
        this.paymentRepository = paymentRepository;
        this.partnerRepository = partnerRepository;
    }
    async findAll() {
        const payments = await this.paymentRepository.findAll();
        return payments.map((payment) => this.toResponseDto(payment));
    }
    async findById(id) {
        const payment = await this.paymentRepository.findById(id);
        if (!payment) {
            throw new common_1.NotFoundException(`Payment with ID ${id} not found`);
        }
        return this.toResponseDto(payment);
    }
    async findByPartnerId(partnerId) {
        const payments = await this.paymentRepository.findByPartnerId(partnerId);
        return payments.map((payment) => this.toResponseDto(payment));
    }
    async findByDateRange(startDate, endDate) {
        const payments = await this.paymentRepository.findByDateRange(new Date(startDate), new Date(endDate));
        return payments.map((payment) => this.toResponseDto(payment));
    }
    async create(createPaymentDto) {
        const partner = await this.partnerRepository.findById(createPaymentDto.partnerId);
        if (!partner) {
            throw new common_1.BadRequestException(`Partner with ID ${createPaymentDto.partnerId} not found`);
        }
        const expectedAmount = partner.montoCuota;
        const amount = createPaymentDto.amount;
        const difference = amount - expectedAmount;
        const payment = new payment_entity_1.Payment({
            partnerId: createPaymentDto.partnerId,
            partnerName: partner.nombre,
            paymentDate: createPaymentDto.paymentDate ? new Date(createPaymentDto.paymentDate) : new Date(),
            amount,
            expectedAmount,
            difference,
            status: payment_entity_1.PaymentStatus.PENDING,
            voucherImageUrl: createPaymentDto.voucherImageUrl,
            whatsappMessageId: createPaymentDto.whatsappMessageId,
            notes: createPaymentDto.notes,
        });
        const created = await this.paymentRepository.create(payment);
        return this.toResponseDto(created);
    }
    async createFromWhatsApp(partnerId, amount, voucherImageUrl, whatsappMessageId) {
        const partner = await this.partnerRepository.findById(partnerId);
        if (!partner) {
            throw new common_1.BadRequestException(`Partner with ID ${partnerId} not found`);
        }
        const expectedAmount = partner.montoCuota;
        const difference = amount - expectedAmount;
        const payment = new payment_entity_1.Payment({
            partnerId,
            partnerName: partner.nombre,
            paymentDate: new Date(),
            amount,
            expectedAmount,
            difference,
            status: payment_entity_1.PaymentStatus.PENDING,
            voucherImageUrl,
            whatsappMessageId,
            notes: 'Payment received via WhatsApp',
        });
        const created = await this.paymentRepository.create(payment);
        return this.toResponseDto(created);
    }
    async update(id, updatePaymentDto) {
        var _a, _b;
        const existing = await this.paymentRepository.findById(id);
        if (!existing) {
            throw new common_1.NotFoundException(`Payment with ID ${id} not found`);
        }
        const updateData = {};
        if (updatePaymentDto.partnerId && updatePaymentDto.partnerId !== existing.partnerId) {
            const partner = await this.partnerRepository.findById(updatePaymentDto.partnerId);
            if (!partner) {
                throw new common_1.BadRequestException(`Partner with ID ${updatePaymentDto.partnerId} not found`);
            }
            updateData.partnerId = updatePaymentDto.partnerId;
            updateData.partnerName = partner.nombre;
            updateData.expectedAmount = partner.montoCuota;
        }
        if (updatePaymentDto.paymentDate) {
            updateData.paymentDate = new Date(updatePaymentDto.paymentDate);
        }
        if (updatePaymentDto.amount !== undefined) {
            updateData.amount = updatePaymentDto.amount;
        }
        if (updatePaymentDto.status) {
            updateData.status = updatePaymentDto.status;
        }
        if (updatePaymentDto.voucherImageUrl !== undefined) {
            updateData.voucherImageUrl = updatePaymentDto.voucherImageUrl;
        }
        if (updatePaymentDto.notes !== undefined) {
            updateData.notes = updatePaymentDto.notes;
        }
        const newAmount = (_a = updateData.amount) !== null && _a !== void 0 ? _a : existing.amount;
        const newExpectedAmount = (_b = updateData.expectedAmount) !== null && _b !== void 0 ? _b : existing.expectedAmount;
        updateData.difference = newAmount - newExpectedAmount;
        const updated = await this.paymentRepository.update(id, updateData);
        return this.toResponseDto(updated);
    }
    async updateStatus(id, status) {
        const existing = await this.paymentRepository.findById(id);
        if (!existing) {
            throw new common_1.NotFoundException(`Payment with ID ${id} not found`);
        }
        const updated = await this.paymentRepository.update(id, { status });
        return this.toResponseDto(updated);
    }
    async delete(id) {
        const existing = await this.paymentRepository.findById(id);
        if (!existing) {
            throw new common_1.NotFoundException(`Payment with ID ${id} not found`);
        }
        await this.paymentRepository.delete(id);
    }
    toResponseDto(payment) {
        return {
            id: payment.id,
            partnerId: payment.partnerId,
            partnerName: payment.partnerName,
            paymentDate: payment.paymentDate,
            amount: payment.amount,
            expectedAmount: payment.expectedAmount,
            difference: payment.difference,
            status: payment.status,
            voucherImageUrl: payment.voucherImageUrl,
            whatsappMessageId: payment.whatsappMessageId,
            notes: payment.notes,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt,
        };
    }
};
PaymentsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)('PaymentRepository')),
    __param(1, (0, common_1.Inject)(partner_repository_1.PARTNER_REPOSITORY)),
    __metadata("design:paramtypes", [Object, Object])
], PaymentsService);
exports.PaymentsService = PaymentsService;
//# sourceMappingURL=payments.service.js.map