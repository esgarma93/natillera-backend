import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

@Injectable()
export class ConfigService {
  get mongoUri(): string {
    return process.env.MONGODB_URI || 'mongodb://localhost:27017/natillera';
  }

  get port(): number {
    return parseInt(process.env.PORT || '3001', 10);
  }

  get nodeEnv(): string {
    return process.env.NODE_ENV || 'development';
  }
}
