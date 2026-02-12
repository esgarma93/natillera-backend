import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './application/users.service';
import { UsersController } from './presentation/users.controller';
import { UserDocument, UserSchema } from './infrastructure/schemas/user.schema';
import { MongoUserRepository } from './infrastructure/repositories/mongo-user.repository';
import { USER_REPOSITORY } from './domain/user.repository';
import { PartnersModule } from '../partners/partners.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserDocument.name, schema: UserSchema },
    ]),
    PartnersModule,
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    {
      provide: USER_REPOSITORY,
      useClass: MongoUserRepository,
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
