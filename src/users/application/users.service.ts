import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { IUserRepository, USER_REPOSITORY } from '../domain/user.repository';
import { User, UserRole } from '../domain/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import * as bcrypt from 'bcryptjs';
import { PartnersService } from '../../partners/application/partners.service';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: IUserRepository,
    private readonly partnersService: PartnersService,
  ) {}

  private async toResponse(user: User): Promise<UserResponseDto> {
    let partnerName: string | undefined;
    try {
      const partner = await this.partnersService.findById(user.partnerId);
      partnerName = partner?.nombre;
    } catch (error) {
      // Partner not found, continue without name
    }

    return {
      id: user.id!,
      celular: user.celular,
      role: user.role,
      partnerId: user.partnerId,
      partnerName,
      activo: user.activo,
      fechaCreacion: user.fechaCreacion,
      fechaActualizacion: user.fechaActualizacion,
    };
  }

  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.userRepository.findAll();
    return Promise.all(users.map((u) => this.toResponse(u)));
  }

  async findById(id: string): Promise<UserResponseDto> {
    const user = await this.userRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return this.toResponse(user);
  }

  async findByCelular(celular: string): Promise<User | null> {
    return this.userRepository.findByCelular(celular);
  }

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    // Check if user already exists
    const existingByCelular = await this.userRepository.findByCelular(dto.celular);
    if (existingByCelular) {
      throw new ConflictException(`User with cellphone ${dto.celular} already exists`);
    }

    const existingByPartner = await this.userRepository.findByPartnerId(dto.partnerId);
    if (existingByPartner) {
      throw new ConflictException(`User for partner ${dto.partnerId} already exists`);
    }

    // Verify partner exists
    const partner = await this.partnersService.findById(dto.partnerId);
    if (!partner) {
      throw new NotFoundException(`Partner with id ${dto.partnerId} not found`);
    }

    // Hash password (4-digit PIN)
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = User.create({
      celular: dto.celular,
      password: hashedPassword,
      role: dto.role,
      partnerId: dto.partnerId,
    });

    const created = await this.userRepository.create(user);
    return this.toResponse(created);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`User with id ${id} not found`);
    }

    // Check unique constraints
    if (dto.celular && dto.celular !== existing.celular) {
      const celularExists = await this.userRepository.findByCelular(dto.celular);
      if (celularExists) {
        throw new ConflictException(`Cellphone ${dto.celular} is already in use`);
      }
    }

    if (dto.partnerId && dto.partnerId !== existing.partnerId) {
      const partnerExists = await this.userRepository.findByPartnerId(dto.partnerId);
      if (partnerExists) {
        throw new ConflictException(`Partner ${dto.partnerId} already has a user`);
      }

      // Verify new partner exists
      const partner = await this.partnersService.findById(dto.partnerId);
      if (!partner) {
        throw new NotFoundException(`Partner with id ${dto.partnerId} not found`);
      }
    }

    // Hash password if provided
    const updateData: Partial<User> = { ...dto };
    if (dto.password) {
      updateData.password = await bcrypt.hash(dto.password, 10);
    }

    existing.update(updateData);
    const updated = await this.userRepository.update(id, existing);
    return this.toResponse(updated!);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.userRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    await this.userRepository.delete(id);
  }

  async validateUser(celular: string, password: string): Promise<User | null> {
    const user = await this.userRepository.findByCelular(celular);
    if (!user || !user.activo) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }
}
