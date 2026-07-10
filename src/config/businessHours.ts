// Operating hours: every day 12:00–22:00 local time.
// Confirm real hours with the business before launch.
const OPEN_HOUR = 12;
const CLOSE_HOUR = 22;

export function isOpen(date: Date): boolean {
  const hour = date.getHours();
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

export function hoursText(): string {
  return "Atendemos todos los días de 12:00 p.m. a 10:00 p.m.";
}
