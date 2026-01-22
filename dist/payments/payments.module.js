"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentsModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const payments_controller_1 = require("./presentation/payments.controller");
const payments_service_1 = require("./application/payments.service");
const mongo_payment_repository_1 = require("./infrastructure/repositories/mongo-payment.repository");
const payment_schema_1 = require("./infrastructure/schemas/payment.schema");
const partners_module_1 = require("../partners/partners.module");
let PaymentsModule = class PaymentsModule {
};
PaymentsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forFeature([
                { name: payment_schema_1.PaymentSchema.name, schema: payment_schema_1.PaymentSchemaFactory },
            ]),
            partners_module_1.PartnersModule,
        ],
        controllers: [payments_controller_1.PaymentsController],
        providers: [
            payments_service_1.PaymentsService,
            {
                provide: 'PaymentRepository',
                useClass: mongo_payment_repository_1.MongoPaymentRepository,
            },
        ],
        exports: [payments_service_1.PaymentsService],
    })
], PaymentsModule);
exports.PaymentsModule = PaymentsModule;
//# sourceMappingURL=payments.module.js.map