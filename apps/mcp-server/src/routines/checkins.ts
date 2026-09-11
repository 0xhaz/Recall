// Wording for check-ins. Kept short and plain, and never on the person's behalf: the family hears
// "Mak Som says good morning" only when Mak Som said it.

export function checkinName(kind: string): string {
  return kind.replace(/^checkin\./, '');
}

export function checkinMessage(kind: string, name: string, time: string): string {
  const part = checkinName(kind);
  return part === 'morning' || part === 'night'
    ? `${name} says good ${part} (${time}).`
    : `${name} checked in (${time}).`;
}

export function promptText(kind: string, name: string): string {
  switch (checkinName(kind)) {
    case 'morning':
      return `Good morning, ${name}. How are you today?`;
    case 'night':
      return `${name}, are you getting ready for bed? Say good night when you're settled.`;
    default:
      return `Hello ${name}, just checking in. How are you?`;
  }
}

function when(kind: string): string {
  const part = checkinName(kind);
  return part === 'morning' ? 'this morning' : part === 'night' ? 'tonight' : 'today';
}

export function missedText(kind: string, name: string, usual: string, asked: string): string {
  return `${name} hasn't checked in ${when(kind)}. Usually around ${usual}; asked at ${asked}, no reply yet.`;
}

export function followupText(name: string, time: string): string {
  return `${name} has now checked in (${time}).`;
}
