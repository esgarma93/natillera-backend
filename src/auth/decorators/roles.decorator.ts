import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/domain/user.entity';

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);
