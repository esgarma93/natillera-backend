import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { RafflesService } from '../application/raffles.service';

@Controller('raffles')
export class RafflesController {
  constructor(private readonly rafflesService: RafflesService) {}

  @Get()
  async findAll() {
    return this.rafflesService.findAll();
  }

  @Get('year/:year')
  async findByYear(@Param('year') year: string) {
    return this.rafflesService.findByYear(parseInt(year, 10));
  }

  @Get('stats/:year')
  async getRaffleStats(@Param('year') year: string) {
    return this.rafflesService.getRaffleStats(parseInt(year, 10));
  }

  @Get(':month/:year')
  async findByMonthAndYear(
    @Param('month') month: string,
    @Param('year') year: string,
  ) {
    return this.rafflesService.findByMonthAndYear(
      parseInt(month, 10),
      parseInt(year, 10),
    );
  }

  @Post('trigger/:month/:year')
  async triggerRaffleDraw(
    @Param('month') month: string,
    @Param('year') year: string,
  ) {
    return this.rafflesService.triggerRaffleDraw(
      parseInt(month, 10),
      parseInt(year, 10),
    );
  }
}
