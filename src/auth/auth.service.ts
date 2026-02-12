import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/application/users.service';
import { PartnersService } from '../partners/application/partners.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { UserRole } from '../users/domain/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly partnersService: PartnersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.usersService.validateUser(loginDto.celular, loginDto.password);
    
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Get partner info
    let partnerName: string | undefined;
    try {
      const partner = await this.partnersService.findById(user.partnerId);
      partnerName = partner?.nombre;
    } catch (error) {
      // Continue without partner name
    }

    const payload = {
      sub: user.id,
      celular: user.celular,
      role: user.role,
      partnerId: user.partnerId,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id!,
        celular: user.celular,
        role: user.role,
        partnerId: user.partnerId,
        partnerName,
      },
    };
  }

  async validateToken(token: string): Promise<any> {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
