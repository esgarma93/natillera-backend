import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Period, PeriodStatus } from '../domain/period.entity';
import { IPeriodRepository, PERIOD_REPOSITORY } from '../domain/period.repository';
import { CreatePeriodDto } from './dto/create-period.dto';
import { UpdatePeriodDto } from './dto/update-period.dto';
import { PeriodResponseDto } from './dto/period-response.dto';

@Injectable()
export class PeriodsService {
  constructor(
    @Inject(PERIOD_REPOSITORY)
    private readonly periodRepository: IPeriodRepository,
  ) {}

  async findAll(): Promise<PeriodResponseDto[]> {
    const periods = await this.periodRepository.findAll();
    return periods.map((period) => this.toResponseDto(period));
  }

  async findById(id: string): Promise<PeriodResponseDto> {
    const period = await this.periodRepository.findById(id);
    if (!period) {
      throw new NotFoundException(`Period with ID ${id} not found`);
    }
    return this.toResponseDto(period);
  }

  async findByYear(year: number): Promise<PeriodResponseDto> {
    const period = await this.periodRepository.findByYear(year);
    if (!period) {
      throw new NotFoundException(`Period for year ${year} not found`);
    }
    return this.toResponseDto(period);
  }

  async findActive(): Promise<PeriodResponseDto | null> {
    const period = await this.periodRepository.findActive();
    return period ? this.toResponseDto(period) : null;
  }

  async getActivePeriod(): Promise<Period> {
    const period = await this.periodRepository.findActive();
    if (!period) {
      throw new NotFoundException('No active period found. Please create and activate a period.');
    }
    return period;
  }

  async create(createPeriodDto: CreatePeriodDto): Promise<PeriodResponseDto> {
    // Check if period for this year already exists
    const existing = await this.periodRepository.findByYear(createPeriodDto.year);
    if (existing) {
      throw new BadRequestException(`Period for year ${createPeriodDto.year} already exists`);
    }

    const period = new Period({
      year: createPeriodDto.year,
      name: createPeriodDto.name || `Natillera ${createPeriodDto.year}`,
      description: createPeriodDto.description,
      startDate: createPeriodDto.startDate || new Date(createPeriodDto.year, 0, 1),
      endDate: createPeriodDto.endDate || new Date(createPeriodDto.year, 11, 31),
      monthlyFee: createPeriodDto.monthlyFee,
      status: createPeriodDto.status || PeriodStatus.UPCOMING,
      totalMonths: createPeriodDto.totalMonths || 12,
    });

    const created = await this.periodRepository.create(period);
    return this.toResponseDto(created);
  }

  async update(id: string, updatePeriodDto: UpdatePeriodDto): Promise<PeriodResponseDto> {
    const existing = await this.periodRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Period with ID ${id} not found`);
    }

    const updated = await this.periodRepository.update(id, {
      ...updatePeriodDto,
      updatedAt: new Date(),
    });

    return this.toResponseDto(updated!);
  }

  async activate(id: string): Promise<PeriodResponseDto> {
    const existing = await this.periodRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Period with ID ${id} not found`);
    }

    // Deactivate current active period
    const currentActive = await this.periodRepository.findActive();
    if (currentActive && currentActive.id !== id) {
      await this.periodRepository.update(currentActive.id!, {
        status: PeriodStatus.CLOSED,
        updatedAt: new Date(),
      });
    }

    // Activate the new period
    const updated = await this.periodRepository.update(id, {
      status: PeriodStatus.ACTIVE,
      updatedAt: new Date(),
    });

    return this.toResponseDto(updated!);
  }

  async close(id: string): Promise<PeriodResponseDto> {
    const existing = await this.periodRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Period with ID ${id} not found`);
    }

    const updated = await this.periodRepository.update(id, {
      status: PeriodStatus.CLOSED,
      updatedAt: new Date(),
    });

    return this.toResponseDto(updated!);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.periodRepository.findById(id);
    if (!existing) {
      throw new NotFoundException(`Period with ID ${id} not found`);
    }

    if (existing.status === PeriodStatus.ACTIVE) {
      throw new BadRequestException('Cannot delete an active period. Please close it first.');
    }

    await this.periodRepository.delete(id);
  }

  private toResponseDto(period: Period): PeriodResponseDto {
    return {
      id: period.id!,
      year: period.year,
      name: period.name,
      description: period.description,
      startDate: period.startDate,
      endDate: period.endDate,
      monthlyFee: period.monthlyFee,
      status: period.status,
      totalMonths: period.totalMonths,
      createdAt: period.createdAt,
      updatedAt: period.updatedAt,
    };
  }
}
