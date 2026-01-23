import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PeriodsService } from '../application/periods.service';
import { CreatePeriodDto } from '../application/dto/create-period.dto';
import { UpdatePeriodDto } from '../application/dto/update-period.dto';
import { PeriodResponseDto } from '../application/dto/period-response.dto';

@Controller('periods')
export class PeriodsController {
  constructor(private readonly periodsService: PeriodsService) {}

  @Get()
  async findAll(): Promise<PeriodResponseDto[]> {
    return this.periodsService.findAll();
  }

  @Get('active')
  async findActive(): Promise<PeriodResponseDto | null> {
    return this.periodsService.findActive();
  }

  @Get('year/:year')
  async findByYear(@Param('year') year: string): Promise<PeriodResponseDto> {
    return this.periodsService.findByYear(parseInt(year, 10));
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<PeriodResponseDto> {
    return this.periodsService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createPeriodDto: CreatePeriodDto): Promise<PeriodResponseDto> {
    return this.periodsService.create(createPeriodDto);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updatePeriodDto: UpdatePeriodDto,
  ): Promise<PeriodResponseDto> {
    return this.periodsService.update(id, updatePeriodDto);
  }

  @Put(':id/activate')
  async activate(@Param('id') id: string): Promise<PeriodResponseDto> {
    return this.periodsService.activate(id);
  }

  @Put(':id/close')
  async close(@Param('id') id: string): Promise<PeriodResponseDto> {
    return this.periodsService.close(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    return this.periodsService.delete(id);
  }
}
