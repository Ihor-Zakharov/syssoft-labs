import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { AppModule } from './app.module.js';
import { CONFIG, type GatewayConfig } from './config.js';
import { DashboardService } from './dashboard.service.js';
import { appRouter } from './trpc/router.js';
import { UpdatesService } from './updates.service.js';

const logger = new Logger('Gateway');

// forceCloseConnections: open SSE streams would otherwise keep `docker stop` waiting for the timeout
const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'], forceCloseConnections: true });
app.enableShutdownHooks();

const api = app.get(DashboardService);
const updates = app.get(UpdatesService);
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: () => ({ api, updates }),
    // Client mistakes (bad input) are the client's problem; log only server-side failures
    onError: ({ path, error }) => {
      if (error.code === 'INTERNAL_SERVER_ERROR') logger.error(`tRPC ${path ?? '?'}: ${error.message}`, error.stack);
    },
  }),
);

const config = app.get<GatewayConfig>(CONFIG);
await app.listen(config.port, '0.0.0.0');
logger.log(`tRPC on :${config.port}/trpc, health on :${config.port}/health`);
