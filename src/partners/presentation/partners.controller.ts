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
import { PartnersService } from '../application/partners.service';
import { CreatePartnerDto } from '../application/dto/create-partner.dto';
import { UpdatePartnerDto } from '../application/dto/update-partner.dto';

@Controller('partners')
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get()
  findAll() {
    return this.partnersService.findAll();
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.partnersService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePartnerDto) {
    return this.partnersService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
    return this.partnersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string) {
    return this.partnersService.delete(id);
  }
}
