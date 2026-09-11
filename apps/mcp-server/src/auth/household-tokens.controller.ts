import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { canManageMembers } from '@recall/core';
import * as z from 'zod';
import { MembershipService } from '../households/membership.service.js';
import { parseBody } from '../http/validation.js';
import { ConsoleAuthService } from './console-auth.service.js';
import { HouseholdTokens } from './household-tokens.service.js';

const CreateTokenBody = z.object({ label: z.string().trim().min(1).max(80) });

/** MCP tokens for a household's devices and assistants. Owner only. */
@Controller('households/:householdId/tokens')
export class HouseholdTokensController {
  constructor(
    @Inject(ConsoleAuthService) private readonly sessions: ConsoleAuthService,
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(HouseholdTokens) private readonly tokens: HouseholdTokens,
  ) {}

  @Post()
  async create(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const personId = await this.requireOwner(householdId, authorization);
    const { label } = parseBody(CreateTokenBody, body);
    return this.tokens.create(householdId, personId, label);
  }

  @Delete(':tokenId')
  @HttpCode(204)
  async revoke(
    @Param('householdId', new ParseUUIDPipe()) householdId: string,
    @Param('tokenId', new ParseUUIDPipe()) tokenId: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const personId = await this.requireOwner(householdId, authorization);
    if (!(await this.tokens.revoke(householdId, tokenId, personId))) {
      throw new NotFoundException('Token not found');
    }
  }

  private async requireOwner(householdId: string, authorization: string | undefined): Promise<string> {
    const personId = await this.sessions.requirePerson(authorization);
    const member = await this.memberships.member(householdId, personId);
    if (!member || !canManageMembers(member)) {
      throw new ForbiddenException('Only the household owner can manage tokens');
    }
    return personId;
  }
}
