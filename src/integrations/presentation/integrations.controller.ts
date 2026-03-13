import { Controller, Get, Post, Put, Delete, Param, Body, Query } from '@nestjs/common';
import { IntegrationsService } from '../application/integrations.service';
import { CreateIntegrationDto } from '../application/dto/create-integration.dto';
import { UpdateIntegrationDto } from '../application/dto/update-integration.dto';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  async findAll() {
    return this.integrationsService.findAll();
  }

  @Get('next')
  async findNextUpcoming() {
    return this.integrationsService.findNextUpcoming();
  }

  @Get('year/:year')
  async findByYear(@Param('year') year: string) {
    return this.integrationsService.findByYear(parseInt(year, 10));
  }

  @Get('stats/:year')
  async getStats(@Param('year') year: string) {
    return this.integrationsService.getStatsByYear(parseInt(year, 10));
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.integrationsService.findById(id);
  }

  @Post()
  async create(@Body() dto: CreateIntegrationDto) {
    return this.integrationsService.create(dto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrationsService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.integrationsService.delete(id);
  }
}
