import { Controller, Get, Post, Put, Param, Body } from '@nestjs/common';
import { PollaService } from '../application/polla.service';
import { CreatePredictionDto } from '../application/dto/create-prediction.dto';
import { SetMatchResultDto } from '../application/dto/set-match-result.dto';

@Controller('polla')
export class PollaController {
  constructor(private readonly pollaService: PollaService) {}

  @Get('matches')
  async findAll() {
    return this.pollaService.findAll();
  }

  @Get('ranking')
  async getRanking() {
    return this.pollaService.getRanking();
  }

  @Get('matches/phase/:phase')
  async findByPhase(@Param('phase') phase: string) {
    return this.pollaService.findByPhase(phase);
  }

  @Get('matches/:id')
  async findById(@Param('id') id: string) {
    return this.pollaService.findById(id);
  }

  @Post('matches/:id/predictions')
  async submitPrediction(@Param('id') id: string, @Body() dto: CreatePredictionDto) {
    return this.pollaService.submitPrediction(id, dto);
  }

  @Put('matches/:id/result')
  async setResult(@Param('id') id: string, @Body() dto: SetMatchResultDto) {
    return this.pollaService.setResult(id, dto);
  }
}
