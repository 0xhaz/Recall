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
const AddPersonBody = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().email().max(200).nullish(),
  // Not 'owner': a household has one, and it is the person who created it.
  role: z.enum(['adult', 'child', 'guest', 'caregiver', 'cared_for']),
});
const ForgetRangeBody = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const PauseBody = z.object({ minutes: z.number().int().min(0).max(720) });

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

const ReminderBody = z.object({
  person: z.string().min(1).max(80),
  kind: z.enum(['medication', 'meal', 'other']).optional(),
  label: z.string().min(2).max(120),
  dose: z.string().max(80).optional(),
  times: z
    .array(z.union([z.string().regex(/^\d{1,2}:\d{2}$/), z.number().int().min(0).max(1439)]))
    .min(1)
    .max(8),
  days: z.enum(['daily', 'weekdays', 'weekends']).optional(),
  device: z.string().max(80).optional(),
  grace_minutes: z.number().int().min(0).max(120).optional(),
  escalate_after_minutes: z.number().int().min(5).max(240).optional(),
});
const ConfirmBody = z.object({ note: z.string().max(300).optional() });

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

  @Post('care/reminders')
  @HttpCode(200)
  async setReminder(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    return this.console.setReminder(household, person, parseBody(ReminderBody, body));
  }

  @Delete('care/reminders/:reminderId')
  async removeReminder(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('reminderId') reminderId: string,
  ) {
    return this.console.removeReminder(household, await this.auth.requirePerson(authorization), reminderId);
  }

  @Post('care/doses/:logId/confirm')
  @HttpCode(200)
  async confirmDose(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('logId') logId: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    const { note } = parseBody(ConfirmBody, body ?? {});
    return this.console.confirmDose(household, person, logId, note);
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

  @Post('people')
  async addPerson(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    return this.console.addPerson(household, person, parseBody(AddPersonBody, body));
  }

  @Delete('people/:subjectId')
  async removePerson(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Param('subjectId') subjectId: string,
  ) {
    const person = await this.auth.requirePerson(authorization);
    return this.console.removePerson(household, person, subjectId);
  }

  @Post('forget-range')
  async forgetRange(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    const { from, to } = parseBody(ForgetRangeBody, body);
    return this.console.forgetRange(household, person, from, to);
  }

  @Post('pause')
  async pause(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
    @Body() body: unknown,
  ) {
    const person = await this.auth.requirePerson(authorization);
    return this.console.pause(household, person, parseBody(PauseBody, body).minutes);
  }

  @Get('export')
  async exportAll(
    @Headers('authorization') authorization: string | undefined,
    @Param('householdId') household: string,
  ) {
    return this.console.export(household, await this.auth.requirePerson(authorization));
  }
}
