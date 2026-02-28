import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  onModuleInit() {
    const url = process.env.REDIS_URL;

    if (!url) {
      throw new Error('REDIS_URL environment variable is not set');
    }

    this.client = new Redis(url, {
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 500, 5000),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      reconnectOnError: (err) => {
        const targetErrors = ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED'];
        return targetErrors.some((e) => err.message.includes(e));
      },
    });

    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('reconnecting', (ms: number) =>
      this.logger.warn(`Redis reconnecting in ${ms}ms`),
    );
    this.client.on('error', (err) => {
      if (err.message?.includes('ECONNRESET')) {
        this.logger.warn('Redis ECONNRESET — will reconnect automatically');
      } else {
        this.logger.error('Redis error:', err);
      }
    });
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }

  /**
   * Get a JSON-parsed value from Redis
   */
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  /**
   * Store a JSON-serialised value with an optional TTL in seconds
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Delete a key
   */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Check whether a key exists
   */
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  /**
   * Reset the TTL of an existing key (sliding expiry)
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }
}
