"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Partner = void 0;
class Partner {
    constructor(partial) {
        var _a;
        this.id = partial.id;
        this.nombre = partial.nombre || '';
        this.montoCuota = partial.montoCuota || 0;
        this.numeroRifa = partial.numeroRifa || 0;
        this.idPartnerPatrocinador = partial.idPartnerPatrocinador;
        this.activo = (_a = partial.activo) !== null && _a !== void 0 ? _a : true;
        this.fechaCreacion = partial.fechaCreacion || new Date();
        this.fechaActualizacion = partial.fechaActualizacion || new Date();
    }
    static create(data) {
        return new Partner({
            ...data,
            fechaCreacion: new Date(),
            fechaActualizacion: new Date(),
            activo: true,
        });
    }
    update(data) {
        if (data.nombre !== undefined)
            this.nombre = data.nombre;
        if (data.montoCuota !== undefined)
            this.montoCuota = data.montoCuota;
        if (data.numeroRifa !== undefined)
            this.numeroRifa = data.numeroRifa;
        if (data.idPartnerPatrocinador !== undefined)
            this.idPartnerPatrocinador = data.idPartnerPatrocinador;
        if (data.activo !== undefined)
            this.activo = data.activo;
        this.fechaActualizacion = new Date();
    }
}
exports.Partner = Partner;
//# sourceMappingURL=partner.entity.js.map