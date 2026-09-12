import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import * as z from 'zod';
import { ConsoleAuthService } from '../auth/console-auth.service.js';
import { parseBody } from '../http/validation.js';
import { ConsoleService } from './console.service.js';

// The console's own API: session-token auth (not a household token), everything scoped to the
// signed-in person. The MCP surface stays for assistants; this is for the people themselves.

const FactQuery = z.object({
  person: z.uuid().optional(),
  query: z.string().max(200).optional(),
  state: z.enum(['current', 'superseded', 'forgotten', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const CorrectBody = z.object({ content: z.string().min(3).max(500) });
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });
const RetentionBody = z.object({ retention_days: z.number().int().min(7).max(365) });
const RoutineDecision = z.object({ decision: z.enum(['accept', 'dismiss']) });
const CarePolicyBody = z.object({
  person: z.string().min(1).max(80),
  topic: z.string().min(2).max(80),
  keywords: z.array(z.string().min(2).max(40)).max(12).optional(),
  policy: z.enum(['correct', 'redirect']),
  guidance: z.string().max(300).optional(),
  remove: z.boolean().optional(),
});

@Controller('console/households/:householdId')
export class ConsoleController {
  constructor(
    @Inject(ConsoleAuthService) private readonly auth: ConsoleAuthService,
    @Inject(ConsoleService) private readonly console: ConsoleService,
  ) {}

  @Get('overview')
  async overview(@Headers('authorization') authorization: string | undefined, @Param('householdId') household: string) {
    return this.console.overview(household, await this.auth.requirePerson(authorization));
  }

  @Get('facts')
  async facts(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Query() query: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    return { facts: await this.console.facts(household, person, parseBody(FactQuery, query)) };
  }

  @Patch('facts/:factId')
  async correct(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('factId') factId: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    const { content } = parseBody(CorrectBody, body);
    return this.console.correctFact(household, person, factId, content);
  }

  @Delete('facts/:factId')
  async forget(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('factId') factId: string,
  ) {
    return this.console.forgetFact(household, await this.auth.requirePerson(authorization), factId);
  }

  @Get('rules')
  async rules(@Headers('authorization') authorization: string | undefined, @Param('householdId') household: string) {
    return this.console.rulesFor(household, await this.auth.requirePerson(authorization));
  }

  @Delete('rules/:ruleId')
  async removeRule(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.console.removeRule(household, await this.auth.requirePerson(authorization), ruleId);
  }

  @Get('routines')
  async routines(@Headers('authorization') authorization: string | undefined, @Param('householdId') household: string) {
    return { routines: await this.console.routines(household, await this.auth.requirePerson(authorization)) };
  }

  @Post('routines/:routineId')
  @HttpCode(200)
  async decideRoutine(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('routineId') routineId: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    const { decision } = parseBody(RoutineDecision, body);
    return this.console.decideRoutine(household, person, routineId, decision);
  }

  @Get('actions')
  async actions(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Query() query: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    const { limit } = parseBody(LimitQuery, query);
    return { actions: await this.console.actions(household, person, limit) };
  }

  @Post('actions/:actionId/undo')
  @HttpCode(200)
  async undo(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('actionId') actionId: string,
  ) {
    return this.console.undoAction(household, await this.auth.requirePerson(authorization), actionId);
  }

  @Get('context')
  async context(@Headers('authorization') authorization: string | undefined, @Param('householdId') household: string) {
    return this.console.context(household, await this.auth.requirePerson(authorization));
  }

  @Get('devices')
  async devices(@Headers('authorization') authorization: string | undefined, @Param('householdId') household: string) {
    return { devices: await this.console.devices(household, await this.auth.requirePerson(authorization)) };
  }

  @Get('people')
  async people(@Headers('authorization') authorization: string | undefined, @Param('householdId') household: string) {
    return { people: await this.console.people(household, await this.auth.requirePerson(authorization)) };
  }

  @Get('notices')
  async notices(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Query() query: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    const { limit } = parseBody(LimitQuery, query);
    return { notices: await this.console.notices(household, person, limit) };
  }

  @Get('care/:subjectId')
  async carePlan(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('subjectId') subjectId: string,
  ) {
    return this.console.carePlan(household, await this.auth.requirePerson(authorization), subjectId);
  }

  @Post('care/policies')
  @HttpCode(200)
  async setCarePolicy(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    return this.console.setCarePolicy(household, person, parseBody(CarePolicyBody, body));
  }

  @Get('settings')
  async settings(@Headers('authorization') authorization: string | undefined, @Param('householdId') household: string) {
    return this.console.settings(household, await this.auth.requirePerson(authorization));
  }

  @Patch('settings')
  async setSettings(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    const { retention_days } = parseBody(RetentionBody, body);
    return this.console.setRetention(household, person, retention_days);
  }

  @Get('export')
  async exportAll(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
  ) {
    return this.console.export(household, await this.auth.requirePerson(authorization));
  }
}
