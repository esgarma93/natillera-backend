import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PollaService } from '../application/polla.service';
import { CreatePredictionDto } from '../application/dto/create-prediction.dto';
import { CreateGuestDto } from '../application/dto/create-guest.dto';
import { SetMatchResultDto } from '../application/dto/set-match-result.dto';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../users/domain/user.entity';

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

  @Get('guests')
  async findAllGuests() {
    return this.pollaService.findAllGuests();
  }

  @Post('guests')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  async createGuest(@Body() dto: CreateGuestDto) {
    return this.pollaService.createGuest(dto);
  }

  @Delete('guests/:id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  async deleteGuest(@Param('id') id: string) {
    return this.pollaService.deleteGuest(id);
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

  @Post('sync-results')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.ADMIN)
  async syncResults() {
    const applied = await this.pollaService.syncResultsFromProvider();
    return { applied };
  }
}
