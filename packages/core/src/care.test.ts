import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARE_POLICIES,
  detectRepeat,
  isNight,
  isUsualAt,
  matchCarePolicies,
  mergeCarePolicies,
  nightOf,
  type PastTurn,
  presenceAlertText,
  sameQuestion,
  sharedWith,
} from './care.js';

const say = (role: PastTurn['role'], text: string): PastTurn => ({ role, text, at: '2026-10-05T08:00:00Z' });

describe('detectRepeat', () => {
  const phone = [
    say('user', 'Where is my phone?'),
    say('assistant', "I don't know where your phone is."),
    say('user', 'Where is my phone?'),
    say('assistant', "I don't know where your phone is."),
  ];

  it('normally speaks up only when the same answer has been given twice', () => {
    const loop = detectRepeat('where is my phone', phone, 'normal');
    expect(loop).toMatchObject({ asked_before: 2, looping: true });
    expect(loop?.guidance).toContain('offer another way');
    expect(detectRepeat('where is my phone', phone.slice(0, 2), 'normal')).toBeNull();
    expect(detectRepeat('where is my wallet', phone, 'normal')).toBeNull();
  });

  it('in care mode, any repeat gets the last answer to give again, warmly', () => {
    const turns = [say('user', 'Is Farah coming today?'), say('assistant', 'Yes, Farah is coming at 3pm.')];
    const repeat = detectRepeat('Is Farah coming today', turns, 'cared_for');
    expect(repeat).toMatchObject({ asked_before: 1, last_answer: 'Yes, Farah is coming at 3pm.' });
    expect(repeat?.guidance).toContain('Never say it was asked before');
  });

  it("doesn't count the request itself when it is already in the log", () => {
    expect(detectRepeat('Is Farah coming today?', [say('user', 'Is Farah coming today?')], 'cared_for')).toBeNull();
  });

  it('matches the same question in other words, not a different one', () => {
    expect(sameQuestion('Is Farah coming?', 'is farah coming today')).toBe(true);
    expect(sameQuestion('What time is it?', 'What day is it?')).toBe(false);
  });
});

describe('care policies', () => {
  it('corrects for safety and redirects on painful topics; a caregiver can override a default', () => {
    expect(matchCarePolicies('Is the stove on?', DEFAULT_CARE_POLICIES).map((p) => p.policy)).toEqual(['correct']);
    expect(matchCarePolicies('I want to go home', DEFAULT_CARE_POLICIES).map((p) => p.topic)).toEqual(['going home']);
    expect(matchCarePolicies('What a lovely day', DEFAULT_CARE_POLICIES)).toEqual([]);

    const ahmad = { topic: 'Ahmad', keywords: ['Ahmad', 'husband'], policy: 'redirect' as const, guidance: null };
    const merged = mergeCarePolicies([{ ...ahmad, set_by: 'caregiver' }]);
    expect(matchCarePolicies('Where is Ahmad?', merged)).toEqual([expect.objectContaining({ topic: 'Ahmad' })]);
    const home = { ...ahmad, topic: 'Going home', keywords: ['home'], guidance: 'Talk about the kampung.' };
    expect(
      mergeCarePolicies([{ ...home, set_by: 'caregiver' }]).filter((p) => p.topic.toLowerCase() === 'going home'),
    ).toHaveLength(1);
  });

  it('says plainly what each caregiver can see', () => {
    expect(sharedWith([{ name: 'Farah', grants: ['edit_care_plan', 'view_daily', 'enter_facts'] }])).toEqual([
      'Farah can see your check-ins and your reminders.',
    ]);
  });
});

describe('presence', () => {
  it('knows night, which night, and what is usual', () => {
    expect([isNight(2 * 60 + 10), isNight(23 * 60), isNight(7 * 60)]).toEqual([true, true, false]);
    expect(nightOf('2026-10-12', 130)).toBe('2026-10-11');
    const nights = ['2026-10-01', '2026-10-03', '2026-10-05'].map((d) => ({ local_date: d, local_minute: 23 * 60 }));
    expect(isUsualAt(23 * 60 + 20, nights)).toBe(true);
    expect(isUsualAt(2 * 60, nights)).toBe(false);
  });

  it('tells the carers what happened, where and when', () => {
    expect(presenceAlertText('door.open', 'Front door', '02:14', ['Mak Som'])).toBe(
      'The door opened (Front door) at 02:14, which is unusual at night. Mak Som may be up.',
    );
  });
});
