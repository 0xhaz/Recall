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
import { ConsoleAuthService } from './console-auth.service.js';

const MagicLinkBody = z.object({ email: z.email() });
const VerifyBody = z.object({ token: z.string().min(1) });

@Controller()
export class ConsoleAuthController {
  constructor(
    @Inject(ConsoleAuthService) private readonly auth: ConsoleAuthService,
    @Inject(MembershipService) private readonly memberships: MembershipService,
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

  @Get('me')
  async me(@Headers('authorization') authorization: string | undefined) {
    const personId = await this.auth.requirePerson(authorization);
    const profile = await this.memberships.profile(personId);
    if (!profile) throw new NotFoundException();
    return profile;
  }
}
