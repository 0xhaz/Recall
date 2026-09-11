import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { loadDotEnv } from './env.js';

loadDotEnv();
const config = loadConfig();

const app = await NestFactory.create(AppModule.register(config));
app.enableShutdownHooks();
await app.listen(config.port, config.host);

Logger.log(`Recall MCP server on http://${config.host}:${config.port}/mcp`, 'Bootstrap');
if (!config.extractionWorker)
  Logger.warn('EXTRACTION_WORKER=off — statements stay pending until a worker runs', 'Bootstrap');
