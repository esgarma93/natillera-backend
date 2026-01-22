"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Payment = exports.PaymentStatus = void 0;
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["PENDING"] = "pending";
    PaymentStatus["VERIFIED"] = "verified";
    PaymentStatus["REJECTED"] = "rejected";
})(PaymentStatus = exports.PaymentStatus || (exports.PaymentStatus = {}));
class Payment {
    constructor(partial) {
        var _a;
        this.id = partial.id;
        this.partnerId = partial.partnerId || '';
        this.partnerName = partial.partnerName;
        this.paymentDate = partial.paymentDate || new Date();
        this.amount = partial.amount || 0;
        this.expectedAmount = partial.expectedAmount || 0;
        this.difference = (_a = partial.difference) !== null && _a !== void 0 ? _a : (this.amount - this.expectedAmount);
        this.status = partial.status || PaymentStatus.PENDING;
        this.voucherImageUrl = partial.voucherImageUrl;
        this.whatsappMessageId = partial.whatsappMessageId;
        this.notes = partial.notes;
        this.createdAt = partial.createdAt || new Date();
        this.updatedAt = partial.updatedAt || new Date();
    }
    isFullPayment() {
        return this.difference >= 0;
    }
    isPartialPayment() {
        return this.difference < 0;
    }
}
exports.Payment = Payment;
//# sourceMappingURL=payment.entity.js.map