import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { IPartnerRepository, PARTNER_REPOSITORY } from '../domain/partner.repository';
import { Partner } from '../domain/partner.entity';
import { CreatePartnerDto } from './dto/create-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { PartnerResponseDto } from './dto/partner-response.dto';

@Injectable()
export class PartnersService {
  constructor(
    @Inject(PARTNER_REPOSITORY)
    private readonly partnerRepository: IPartnerRepository,
  ) {}

  private toResponse(partner: Partner): PartnerResponseDto {
    return {
      id: partner.id!,
      nombre: partner.nombre,
      celular: partner.celular,
      montoCuota: partner.montoCuota,
      numeroRifa: partner.numeroRifa,
      idPartnerPatrocinador: partner.idPartnerPatrocinador,
      activo: partner.activo,
      fechaCreacion: partner.fechaCreacion,
      fechaActualizacion: partner.fechaActualizacion,
    };
  }

  async findAll(): Promise<PartnerResponseDto[]> {
    const partners = await this.partnerRepository.findAll();
    return partners.map((p) => this.toResponse(p));
  }

  async findById(id: string): Promise<PartnerResponseDto> {
    const partner = await this.partnerRepository.findById(id);
    if (!partner) {
      throw new NotFoundException(`Partner with id ${id} not found`);
    }
    return this.toResponse(partner);
  }

  async findByNumeroRifa(numeroRifa: number): Promise<PartnerResponseDto | null> {
    const partner = await this.partnerRepository.findByNumeroRifa(numeroRifa);
    if (!partner) {
      return null;
    }
    return this.toResponse(partner);
  }

  async findByCelular(celular: string): Promise<PartnerResponseDto | null> {
    const partner = await this.partnerRepository.findByCelular(celular);
    if (!partner) {
      return null;
    }
    return this.toResponse(partner);
  }

  async create(dto: CreatePartnerDto): Promise<PartnerResponseDto> {
    const existing = await this.partnerRepository.findByNumeroRifa(dto.numeroRifa);
    if (existing) {
      throw new ConflictException(`Raffle number ${dto.numeroRifa} is already assigned`);
    }

    if (dto.idPartnerPatrocinador) {
      const sponsor = await this.partnerRepository.findById(dto.idPartnerPatrocinador);
      if (!sponsor) {
        throw new NotFoundException(`Sponsor partner with id ${dto.idPartnerPatrocinador} not found`);
      }
    }

    const partner = Partner.create(dto);
    const created = await this.partnerRepository.create(partner);
    return this.toResponse(created);
  }

  async update(id: string, dto: UpdatePartnerDto): Promise<PartnerResponseDto> {
    const existing = await this.partnerRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Partner with id ${id} not found`);
    }

    if (dto.numeroRifa && dto.numeroRifa !== existing.numeroRifa) {
      const rifaExists = await this.partnerRepository.findByNumeroRifa(dto.numeroRifa);
      if (rifaExists) {
        throw new ConflictException(`Raffle number ${dto.numeroRifa} is already assigned`);
      }
    }

    if (dto.idPartnerPatrocinador) {
      const sponsor = await this.partnerRepository.findById(dto.idPartnerPatrocinador);
      if (!sponsor) {
        throw new NotFoundException(`Sponsor partner with id ${dto.idPartnerPatrocinador} not found`);
      }
    }

    existing.update(dto);
    const updated = await this.partnerRepository.update(id, existing);
    return this.toResponse(updated!);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.partnerRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Partner with id ${id} not found`);
    }
    await this.partnerRepository.delete(id);
  }
}
