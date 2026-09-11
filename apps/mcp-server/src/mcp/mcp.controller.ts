import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Controller, Delete, Get, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { HouseholdAuth } from '../auth/household-auth.js';
import { MemoryService } from '../memory/memory.service.js';
import { buildMcpServer } from './tools.js';

function rpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

/** MCP over Streamable HTTP (spec 2025-11-25), stateless: a fresh server and transport per request. */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    @Inject(HouseholdAuth) private readonly auth: HouseholdAuth,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const ctx = await this.auth.authenticate(req.headers.authorization);
    if (!ctx) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      rpcError(res, 401, -32001, 'Unauthorized');
      return;
    }

    const server = buildMcpServer(ctx, this.memory);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error(err);
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
    }
  }

  // Stateless mode: no server-initiated stream and no sessions to delete.
  @Get()
  get(@Res() res: Response): void {
    rpcError(res, 405, -32000, 'Method not allowed.');
  }

  @Delete()
  delete(@Res() res: Response): void {
    rpcError(res, 405, -32000, 'Method not allowed.');
  }
}
