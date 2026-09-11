import { BadRequestException } from '@nestjs/common';
import type * as z from 'zod';

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`));
  }
  return result.data;
}
