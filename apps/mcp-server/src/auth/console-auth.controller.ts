import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import * as z from 'zod';
import { MembershipService } from '../households/membership.service.js';
import { parseBody } from '../http/validation.js';
import { ForgetService } from '../memory/forget.service.js';
import { ConsoleAuthService } from './console-auth.service.js';

const MagicLinkBody = z.object({ email: z.email() });
const DemoBody = z.object({ person: z.string().max(80).optional() });
const VerifyBody = z.object({ token: z.string().min(1) });
/** Typed confirmation, so "forget me" can't happen by accident. */
const ForgetMeBody = z.object({ confirm: z.literal('forget me') });

@Controller()
export class ConsoleAuthController {
  constructor(
    @Inject(ConsoleAuthService) private readonly auth: ConsoleAuthService,
    @Inject(MembershipService) private readonly memberships: MembershipService,
    @Inject(ForgetService) private readonly forget: ForgetService,
  ) {}

  @Post('auth/magic-link')
  @HttpCode(202)
  async requestLink(@Body() body: unknown) {
    const { email } = parseBody(MagicLinkBody, body);
    await this.auth.requestLink(email);
    return { ok: true };
  }

  @Post('auth/verify')
  @HttpCode(200)
  async verify(@Body() body: unknown) {
    const { token } = parseBody(VerifyBody, body);
    const session = await this.auth.verify(token);
    if (!session) throw new UnauthorizedException('This sign-in link has expired or was already used');
    return session;
  }

  /** Whether this deployment offers demo sign-in, so the console never shows a button it cannot use. */
  @Get('auth/demo')
  async demoOffered() {
    return { enabled: await this.auth.demoOffered() };
  }

  /** One-click sign-in to the seeded demo household. 404s unless DEMO_SIGN_IN=on. */
  @Post('auth/demo')
  @HttpCode(200)
  async demo(@Body() body: unknown) {
    const { person } = parseBody(DemoBody, body);
    const session = await this.auth.demoSession(person);
    if (!session) throw new NotFoundException('Demo sign-in is not enabled here');
    return session;
  }

  @Get('me')
  async me(@Headers('authorization') authorization: string | undefined) {
    const personId = await this.auth.requirePerson(authorization);
    const profile = await this.memberships.profile(personId);
    if (!profile) throw new NotFoundException();
    return profile;
  }

  /** Forget me: erase this person's memory in every household and revoke their access. */
  @Post('me/forget')
  @HttpCode(200)
  async forgetMe(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    const personId = await this.auth.requirePerson(authorization);
    parseBody(ForgetMeBody, body);
    return this.forget.forgetPerson(personId);
  }
}
