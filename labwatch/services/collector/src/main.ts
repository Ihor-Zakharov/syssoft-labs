import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { CONFIG, type CollectorConfig } from './config.js';

const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
// SIGTERM from `docker stop` → pollers stop, connections close cleanly
app.enableShutdownHooks();

const config = app.get<CollectorConfig>(CONFIG);
await app.listen(config.port, '0.0.0.0');
new Logger('Collector').log(`Health endpoint on :${config.port}/health, watching ${config.repos.join(', ')}`);
