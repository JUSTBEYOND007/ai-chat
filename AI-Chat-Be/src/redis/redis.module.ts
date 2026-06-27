import { createClient } from 'redis';

import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';

class MemoryRedisClient {
  private store = new Map<string, string>();
  private timers = new Map<string, NodeJS.Timeout>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string | number) {
    this.store.set(key, String(value));
  }

  async expire(key: string, ttl: number) {
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.store.delete(key);
      this.timers.delete(key);
    }, ttl * 1000);

    this.timers.set(key, timer);
  }
}

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: 'REDIS_CLIENT',
      async useFactory(configService: ConfigService) {
        const redisClient = createClient({
          socket: {
            host: configService.get('redis_server_host'),
            port: configService.get('redis_server_port'),
          },
          database: configService.get('redis_server_db'),
        });

        try {
          await redisClient.connect();
          return redisClient;
        } catch (error) {
          console.warn(
            '[RedisModule] Redis is unavailable, falling back to in-memory cache for local development.',
            error,
          );
          return new MemoryRedisClient();
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
