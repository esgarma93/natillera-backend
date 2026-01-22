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
exports.MongoPartnerRepository = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const partner_entity_1 = require("../../domain/partner.entity");
const partner_schema_1 = require("../schemas/partner.schema");
let MongoPartnerRepository = class MongoPartnerRepository {
    constructor(partnerModel) {
        this.partnerModel = partnerModel;
    }
    toDomain(doc) {
        var _a;
        return new partner_entity_1.Partner({
            id: doc._id.toString(),
            nombre: doc.nombre,
            montoCuota: doc.montoCuota,
            numeroRifa: doc.numeroRifa,
            idPartnerPatrocinador: ((_a = doc.idPartnerPatrocinador) === null || _a === void 0 ? void 0 : _a.toString()) || undefined,
            activo: doc.activo,
            fechaCreacion: doc.createdAt,
            fechaActualizacion: doc.updatedAt,
        });
    }
    async findAll() {
        const docs = await this.partnerModel.find().sort({ nombre: 1 }).exec();
        return docs.map((doc) => this.toDomain(doc));
    }
    async findById(id) {
        const doc = await this.partnerModel.findById(id).exec();
        return doc ? this.toDomain(doc) : null;
    }
    async findByNumeroRifa(numeroRifa) {
        const doc = await this.partnerModel.findOne({ numeroRifa }).exec();
        return doc ? this.toDomain(doc) : null;
    }
    async create(partner) {
        const created = new this.partnerModel({
            nombre: partner.nombre,
            montoCuota: partner.montoCuota,
            numeroRifa: partner.numeroRifa,
            idPartnerPatrocinador: partner.idPartnerPatrocinador || null,
            activo: partner.activo,
        });
        const saved = await created.save();
        return this.toDomain(saved);
    }
    async update(id, data) {
        const updated = await this.partnerModel
            .findByIdAndUpdate(id, { $set: data }, { new: true })
            .exec();
        return updated ? this.toDomain(updated) : null;
    }
    async delete(id) {
        const result = await this.partnerModel.findByIdAndDelete(id).exec();
        return !!result;
    }
};
MongoPartnerRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(partner_schema_1.PartnerDocument.name)),
    __metadata("design:paramtypes", [mongoose_2.Model])
], MongoPartnerRepository);
exports.MongoPartnerRepository = MongoPartnerRepository;
//# sourceMappingURL=mongo-partner.repository.js.map