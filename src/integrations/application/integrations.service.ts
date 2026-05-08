import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Integration, IntegrationStatus } from '../domain/integration.entity';
import { IIntegrationRepository, INTEGRATION_REPOSITORY } from '../domain/integration.repository';
import { PartnersService } from '../../partners/application/partners.service';
import { PeriodsService } from '../../periods/application/periods.service';
import { CreateIntegrationDto } from './dto/create-integration.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';
import { IntegrationResponseDto } from './dto/integration-response.dto';

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(INTEGRATION_REPOSITORY)
    private readonly integrationRepository: IIntegrationRepository,
    private readonly partnersService: PartnersService,
    private readonly periodsService: PeriodsService,
  ) {}

  async findAll(): Promise<IntegrationResponseDto[]> {
    const integrations = await this.integrationRepository.findAll();
    return integrations.map(i => this.toResponseDto(i));
  }

  async findById(id: string): Promise<IntegrationResponseDto> {
    const integration = await this.integrationRepository.findById(id);
    if (!integration) throw new NotFoundException(`Integration ${id} not found`);
    return this.toResponseDto(integration);
  }

  async findByYear(year: number): Promise<IntegrationResponseDto[]> {
    const integrations = await this.integrationRepository.findByYear(year);
    return integrations.map(i => this.toResponseDto(i));
  }

  async findNextUpcoming(): Promise<IntegrationResponseDto | null> {
    const upcoming = await this.integrationRepository.findByStatus(IntegrationStatus.UPCOMING);
    const active = await this.integrationRepository.findByStatus(IntegrationStatus.ACTIVE);
    const all = [...upcoming, ...active].sort((a, b) => a.date.getTime() - b.date.getTime());
    return all.length > 0 ? this.toResponseDto(all[0]) : null;
  }

  /** Find integrations that are active or upcoming with date <= today (pending settlement via WhatsApp) */
  async findPendingForPayment(): Promise<IntegrationResponseDto[]> {
    const upcoming = await this.integrationRepository.findByStatus(IntegrationStatus.UPCOMING);
    const active = await this.integrationRepository.findByStatus(IntegrationStatus.ACTIVE);
    const now = new Date();
    const pending = [...upcoming, ...active].filter(i => i.date <= now);
    return pending.map(i => this.toResponseDto(i));
  }

  async create(dto: CreateIntegrationDto): Promise<IntegrationResponseDto> {
    const activePeriod = await this.periodsService.getActivePeriod();
    const host = await this.partnersService.findById(dto.hostPartnerId);

    const integration = new Integration({
      periodId: activePeriod.id,
      periodYear: activePeriod.year,
      name: dto.name,
      date: dto.date,
      hostPartnerId: dto.hostPartnerId,
      hostPartnerName: host.nombre,
      foodCostPerPerson: dto.foodCostPerPerson ?? 0,
      profitabilityPerPerson: activePeriod.profitabilityPerPerson,
      activityCostPerPerson: activePeriod.activityCostPerPerson,
      status: IntegrationStatus.UPCOMING,
      notes: dto.notes,
    });
    integration.recalculate();

    const created = await this.integrationRepository.create(integration);
    return this.toResponseDto(created);
  }

  async update(id: string, dto: UpdateIntegrationDto): Promise<IntegrationResponseDto> {
    const existing = await this.integrationRepository.findById(id);
    if (!existing) throw new NotFoundException(`Integration ${id} not found`);

    // Update basic fields
    if (dto.name !== undefined) existing.name = dto.name;
    if (dto.date !== undefined) existing.date = dto.date;
    if (dto.notes !== undefined) existing.notes = dto.notes;
    if (dto.status !== undefined) existing.status = dto.status;

    if (dto.hostPartnerId !== undefined) {
      const host = await this.partnersService.findById(dto.hostPartnerId);
      existing.hostPartnerId = dto.hostPartnerId;
      existing.hostPartnerName = host.nombre;
    }

    if (dto.foodCostPerPerson !== undefined) {
      existing.foodCostPerPerson = dto.foodCostPerPerson;
    }

    // Update attendees list
    if (dto.attendees !== undefined) {
      const resolvedAttendees = [];
      for (const att of dto.attendees) {
        if (att.isGuest) {
          let invitedByName: string | undefined;
          if (att.invitedByPartnerId) {
            try {
              const inviter = await this.partnersService.findById(att.invitedByPartnerId);
              invitedByName = inviter.nombre;
            } catch { /* inviter not found, leave undefined */ }
          }
          resolvedAttendees.push({
            partnerId: att.partnerId || '',
            partnerName: att.guestName || 'Invitado',
            isGuest: true,
            guestName: att.guestName,
            invitedByPartnerId: att.invitedByPartnerId,
            invitedByPartnerName: invitedByName,
            paymentMode: att.paymentMode,
            activityOnly: att.activityOnly === true,
            paid: att.paid === true,
            paymentId: att.paymentId,
          });
        } else {
          try {
            const partner = await this.partnersService.findById(att.partnerId);
            const existingAtt = existing.attendees.find(a => a.partnerId === partner.id && !a.isGuest);
            resolvedAttendees.push({
              partnerId: partner.id,
              partnerName: partner.nombre,
              isGuest: false,
              paid: att.paid === true || existingAtt?.paid === true,
              paymentId: att.paymentId || existingAtt?.paymentId,
            });
          } catch { continue; }
        }
      }
      existing.attendees = resolvedAttendees;
    }

    // Update absent partners
    if (dto.absentPartnerIds !== undefined) {
      existing.absentPartnerIds = dto.absentPartnerIds;
    }

    // Update activity winner
    if (dto.activityWinnerId !== undefined) {
      if (dto.activityWinnerId) {
        const winner = await this.partnersService.findById(dto.activityWinnerId);
        existing.activityWinnerId = dto.activityWinnerId;
        existing.activityWinnerName = winner.nombre;
      } else {
        existing.activityWinnerId = undefined;
        existing.activityWinnerName = undefined;
      }
    }

    existing.recalculate();

    const updated = await this.integrationRepository.update(id, existing);
    if (!updated) throw new NotFoundException(`Integration ${id} not found`);
    return this.toResponseDto(updated);
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.integrationRepository.delete(id);
    if (!deleted) throw new NotFoundException(`Integration ${id} not found`);
  }

  async getStatsByYear(year: number): Promise<{
    totalIntegrations: number;
    totalCollected: number;
    totalFoodPayout: number;
    totalProfitability: number;
    totalActivityPrizes: number;
  }> {
    const integrations = await this.integrationRepository.findByYear(year);
    return {
      totalIntegrations: integrations.length,
      totalCollected: integrations.reduce((sum, i) => sum + i.getTotalCollected(), 0),
      totalFoodPayout: integrations.reduce((sum, i) => sum + i.getFoodPayout(), 0),
      totalProfitability: integrations.reduce((sum, i) => sum + i.getProfitability(), 0),
      totalActivityPrizes: integrations.reduce((sum, i) => sum + i.activityPrize, 0),
    };
  }

  /** Mark an attendee as paid (called when a payment is created) */
  async markAttendeePaid(integrationId: string, partnerId: string, paymentId: string): Promise<void> {
    const integration = await this.integrationRepository.findById(integrationId);
    if (!integration) return;

    const attendee = integration.attendees.find(a => a.partnerId === partnerId);
    if (attendee) {
      attendee.paid = true;
      attendee.paymentId = paymentId;
    }
    await this.integrationRepository.update(integrationId, { attendees: integration.attendees } as any);
  }

  /** Add a partner as attendee from a WhatsApp payment and mark as paid.
   * Respects existing classification: if the partner was already marked as absent,
   * the absent status is preserved (admin/socio decision is not overwritten by a payment). */
  async addAttendeeFromPayment(integrationId: string, partnerId: string, partnerName: string, paymentId: string): Promise<void> {
    const integration = await this.integrationRepository.findById(integrationId);
    if (!integration) return;

    const wasAbsent = integration.absentPartnerIds.includes(partnerId);
    const existingAttendee = integration.attendees.find(a => a.partnerId === partnerId && !a.isGuest);

    if (existingAttendee) {
      // Already an attendee — just mark as paid
      existingAttendee.paid = true;
      existingAttendee.paymentId = paymentId;
    } else if (wasAbsent) {
      // Respect existing absent classification — do NOT promote to attendee. Payment is
      // tracked independently via the payments collection (Payment.integrationId).
    } else {
      // No prior classification — add as attendee
      integration.attendees.push({
        partnerId,
        partnerName,
        isGuest: false,
        paid: true,
        paymentId,
      });
    }

    integration.recalculate();
    await this.integrationRepository.update(integrationId, integration);
  }

  /** Add a named guest attendee from a WhatsApp payment */
  async addGuestAttendeeFromPayment(
    integrationId: string, guestName: string,
    invitedByPartnerId: string, paymentId: string,
  ): Promise<void> {
    const integration = await this.integrationRepository.findById(integrationId);
    if (!integration) return;
    integration.attendees.push({
      partnerId: invitedByPartnerId,
      partnerName: guestName,
      isGuest: true,
      guestName,
      invitedByPartnerId,
      paid: true,
      paymentId,
    });
    integration.recalculate();
    await this.integrationRepository.update(integrationId, integration);
  }

  /** Add a partner as absent from a WhatsApp payment.
   * Respects existing classification: if the partner was already added as attendee,
   * the attendee status is preserved (admin/socio decision is not overwritten). */
  async addAbsentFromPayment(integrationId: string, partnerId: string): Promise<void> {
    const integration = await this.integrationRepository.findById(integrationId);
    if (!integration) return;

    const existingAttendee = integration.attendees.find(a => a.partnerId === partnerId && !a.isGuest);
    if (existingAttendee) {
      // Respect existing attendee classification — do NOT demote to absent.
      // Payment is tracked independently via Payment.integrationId.
      return;
    }

    if (!integration.absentPartnerIds.includes(partnerId)) {
      integration.absentPartnerIds.push(partnerId);
    }

    integration.recalculate();
    await this.integrationRepository.update(integrationId, integration);
  }

  private toResponseDto(integration: Integration): IntegrationResponseDto {
    return {
      id: integration.id!,
      periodId: integration.periodId,
      periodYear: integration.periodYear,
      name: integration.name,
      date: integration.date,
      hostPartnerId: integration.hostPartnerId,
      hostPartnerName: integration.hostPartnerName,
      foodCostPerPerson: integration.foodCostPerPerson,
      profitabilityPerPerson: integration.profitabilityPerPerson,
      activityCostPerPerson: integration.activityCostPerPerson,
      totalCostPerPerson: integration.totalCostPerPerson,
      absentPenalty: integration.absentPenalty,
      activityWinnerId: integration.activityWinnerId,
      activityWinnerName: integration.activityWinnerName,
      activityPot: integration.activityPot,
      activityPrize: integration.activityPrize,
      attendees: integration.attendees,
      absentPartnerIds: integration.absentPartnerIds,
      status: integration.status,
      notes: integration.notes,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
      totalCollected: integration.getTotalCollected(),
      foodPayout: integration.getFoodPayout(),
      profitability: integration.getProfitability(),
    };
  }
}
