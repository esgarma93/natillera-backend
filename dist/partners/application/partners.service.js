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
exports.PartnersService = void 0;
const common_1 = require("@nestjs/common");
const partner_repository_1 = require("../domain/partner.repository");
const partner_entity_1 = require("../domain/partner.entity");
let PartnersService = class PartnersService {
    constructor(partnerRepository) {
        this.partnerRepository = partnerRepository;
    }
    toResponse(partner) {
        return {
            id: partner.id,
            nombre: partner.nombre,
            montoCuota: partner.montoCuota,
            numeroRifa: partner.numeroRifa,
            idPartnerPatrocinador: partner.idPartnerPatrocinador,
            activo: partner.activo,
            fechaCreacion: partner.fechaCreacion,
            fechaActualizacion: partner.fechaActualizacion,
        };
    }
    async findAll() {
        const partners = await this.partnerRepository.findAll();
        return partners.map((p) => this.toResponse(p));
    }
    async findById(id) {
        const partner = await this.partnerRepository.findById(id);
        if (!partner) {
            throw new common_1.NotFoundException(`Partner with id ${id} not found`);
        }
        return this.toResponse(partner);
    }
    async findByNumeroRifa(numeroRifa) {
        const partner = await this.partnerRepository.findByNumeroRifa(numeroRifa);
        if (!partner) {
            return null;
        }
        return this.toResponse(partner);
    }
    async create(dto) {
        const existing = await this.partnerRepository.findByNumeroRifa(dto.numeroRifa);
        if (existing) {
            throw new common_1.ConflictException(`Raffle number ${dto.numeroRifa} is already assigned`);
        }
        if (dto.idPartnerPatrocinador) {
            const sponsor = await this.partnerRepository.findById(dto.idPartnerPatrocinador);
            if (!sponsor) {
                throw new common_1.NotFoundException(`Sponsor partner with id ${dto.idPartnerPatrocinador} not found`);
            }
        }
        const partner = partner_entity_1.Partner.create(dto);
        const created = await this.partnerRepository.create(partner);
        return this.toResponse(created);
    }
    async update(id, dto) {
        const existing = await this.partnerRepository.findById(id);
        if (!existing) {
            throw new common_1.NotFoundException(`Partner with id ${id} not found`);
        }
        if (dto.numeroRifa && dto.numeroRifa !== existing.numeroRifa) {
            const rifaExists = await this.partnerRepository.findByNumeroRifa(dto.numeroRifa);
            if (rifaExists) {
                throw new common_1.ConflictException(`Raffle number ${dto.numeroRifa} is already assigned`);
            }
        }
        if (dto.idPartnerPatrocinador) {
            const sponsor = await this.partnerRepository.findById(dto.idPartnerPatrocinador);
            if (!sponsor) {
                throw new common_1.NotFoundException(`Sponsor partner with id ${dto.idPartnerPatrocinador} not found`);
            }
        }
        existing.update(dto);
        const updated = await this.partnerRepository.update(id, existing);
        return this.toResponse(updated);
    }
    async delete(id) {
        const existing = await this.partnerRepository.findById(id);
        if (!existing) {
            throw new common_1.NotFoundException(`Partner with id ${id} not found`);
        }
        await this.partnerRepository.delete(id);
    }
};
PartnersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(partner_repository_1.PARTNER_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], PartnersService);
exports.PartnersService = PartnersService;
//# sourceMappingURL=partners.service.js.map