import { describe, expect, it } from 'vitest';
import { screen } from './sensitivity.js';

describe('screen', () => {
  it('drops a Luhn-valid card number entirely', () => {
    expect(screen('My card number is 4111 1111 1111 1111.')).toEqual({
      text: '',
      redactions: ['card_number'],
      tags: [],
    });
  });

  it('keeps long numbers that are not card numbers', () => {
    expect(screen('Order 1234 5678 9012 3456 arrived.').redactions).toEqual([]);
  });

  it('removes only the offending clause', () => {
    expect(screen("I'm vegetarian now, and my password is hunter2.")).toEqual({
      text: "I'm vegetarian now",
      redactions: ['credential'],
      tags: [],
    });
  });

  it('never stores diagnoses, even about someone else', () => {
    const result = screen("Remember I'm vegetarian. My brother Amir was diagnosed with diabetes.");
    expect(result.text).toBe("Remember I'm vegetarian.");
    expect(result.redactions).toEqual(['diagnosis']);
  });

  it('blocks national ids and account numbers', () => {
    expect(screen('My IC is 900101-14-5678').redactions).toEqual(['national_id']);
    expect(screen('Our account number is 1234 5678 90').redactions).toEqual(['account_number']);
  });

  it('keeps allergies but tags them as health', () => {
    expect(screen('Sofia is allergic to peanuts')).toEqual({
      text: 'Sofia is allergic to peanuts',
      redactions: [],
      tags: ['health'],
    });
  });
});
