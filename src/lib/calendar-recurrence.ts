import type { CalendarEvent } from "../types";

export interface CalendarOccurrence extends CalendarEvent {
  occurrenceId: string;
  sourceEventId: string;
  isRecurringOccurrence: boolean;
}

function addOccurrence(date: Date, recurrence: NonNullable<CalendarEvent["recurrence"]>): Date {
  const next = new Date(date);
  if (recurrence === "daily") next.setDate(next.getDate() + 1);
  else if (recurrence === "weekly") next.setDate(next.getDate() + 7);
  else if (recurrence === "monthly") next.setMonth(next.getMonth() + 1);
  else if (recurrence === "yearly") next.setFullYear(next.getFullYear() + 1);
  return next;
}

function occurrenceKey(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toISOString();
}

export function expandCalendarEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarOccurrence[] {
  const output: CalendarOccurrence[] = [];
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();

  for (const event of events) {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;

    const duration = Math.max(0, end.getTime() - start.getTime());
    const recurrence = event.recurrence ?? "none";

    if (event.recurrenceParentId || recurrence === "none") {
      if (end.getTime() >= startMs && start.getTime() <= endMs) {
        output.push({
          ...event,
          occurrenceId: event.id,
          sourceEventId: event.recurrenceParentId ?? event.id,
          isRecurringOccurrence: Boolean(event.recurrenceParentId),
        });
      }
      continue;
    }

    const until = event.recurrenceUntil
      ? new Date(event.recurrenceUntil).getTime() + 86_399_999
      : Math.min(endMs, start.getTime() + 366 * 5 * 86_400_000);
    const exceptionKeys = new Set((event.recurrenceExceptions ?? []).map(occurrenceKey));
    let cursor = new Date(start);
    let guard = 0;

    while (cursor.getTime() <= endMs && cursor.getTime() <= until && guard < 4000) {
      const cursorEnd = cursor.getTime() + duration;
      const cursorIso = cursor.toISOString();
      if (
        cursorEnd >= startMs &&
        !exceptionKeys.has(occurrenceKey(cursorIso))
      ) {
        output.push({
          ...event,
          startAt: cursorIso,
          endAt: new Date(cursorEnd).toISOString(),
          occurrenceOriginalStart: cursorIso,
          occurrenceId: `${event.id}::${cursorIso}`,
          sourceEventId: event.id,
          isRecurringOccurrence: true,
        });
      }
      cursor = addOccurrence(cursor, recurrence);
      guard += 1;
    }
  }

  return output.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function eventConflicts(
  candidate: CalendarEvent,
  allEvents: CalendarEvent[],
): CalendarEvent[] {
  const start = new Date(candidate.startAt).getTime();
  const end = new Date(candidate.endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const rangeStart = new Date(start - 31 * 86_400_000);
  const rangeEnd = new Date(end + 31 * 86_400_000);
  const occurrences = expandCalendarEvents(allEvents, rangeStart, rangeEnd);

  return occurrences
    .filter((event) => event.sourceEventId !== (candidate.recurrenceParentId ?? candidate.id))
    .filter((event) => event.status !== "cancelled" && event.freeBusyStatus !== "free")
    .filter((event) => {
      const otherStart = new Date(event.startAt).getTime();
      const otherEnd = new Date(event.endAt).getTime();
      return start < otherEnd && end > otherStart;
    });
}

export function suggestMeetingSlots(
  candidate: CalendarEvent,
  allEvents: CalendarEvent[],
  count = 5,
): Array<{ startAt: string; endAt: string }> {
  const originalStart = new Date(candidate.startAt);
  const originalEnd = new Date(candidate.endAt);
  const duration = Math.max(30 * 60_000, originalEnd.getTime() - originalStart.getTime());
  const suggestions: Array<{ startAt: string; endAt: string }> = [];
  const date = new Date(originalStart);

  date.setSeconds(0, 0);
  const minutes = date.getMinutes();
  date.setMinutes(minutes <= 30 ? 30 : 60);

  for (let tries = 0; tries < 14 * 48 && suggestions.length < count; tries += 1) {
    if (date.getHours() < 8) date.setHours(8, 0, 0, 0);
    if (date.getHours() >= 18) {
      date.setDate(date.getDate() + 1);
      date.setHours(8, 0, 0, 0);
    }
    if (date.getDay() === 0 || date.getDay() === 6) {
      date.setDate(date.getDate() + (date.getDay() === 6 ? 2 : 1));
      date.setHours(8, 0, 0, 0);
    }

    const end = new Date(date.getTime() + duration);
    const test = { ...candidate, startAt: date.toISOString(), endAt: end.toISOString() };
    if (eventConflicts(test, allEvents).length === 0) {
      suggestions.push({ startAt: date.toISOString(), endAt: end.toISOString() });
    }
    date.setMinutes(date.getMinutes() + 30);
  }

  return suggestions;
}

export function exceptionOccurrence(
  series: CalendarEvent,
  occurrenceStartAt: string,
  changes: Partial<CalendarEvent>,
): { series: CalendarEvent; exception: CalendarEvent } {
  const sourceStart = new Date(series.startAt).getTime();
  const sourceEnd = new Date(series.endAt).getTime();
  const occurrenceStart = new Date(occurrenceStartAt);
  const duration = Math.max(0, sourceEnd - sourceStart);
  const key = occurrenceStart.toISOString();

  return {
    series: {
      ...series,
      recurrenceExceptions: [...new Set([...(series.recurrenceExceptions ?? []), key])],
    },
    exception: {
      ...series,
      ...changes,
      id: crypto.randomUUID(),
      recurrence: "none",
      recurrenceUntil: undefined,
      recurrenceExceptions: undefined,
      recurrenceParentId: series.id,
      occurrenceOriginalStart: key,
      startAt: changes.startAt ?? key,
      endAt: changes.endAt ?? new Date(occurrenceStart.getTime() + duration).toISOString(),
      reminderNotifiedAt: undefined,
    },
  };
}

export function splitRecurringSeries(
  series: CalendarEvent,
  occurrenceStartAt: string,
  changes: Partial<CalendarEvent>,
): { previous: CalendarEvent; following: CalendarEvent } {
  const occurrence = new Date(occurrenceStartAt);
  const dayBefore = new Date(occurrence);
  dayBefore.setDate(dayBefore.getDate() - 1);

  return {
    previous: {
      ...series,
      recurrenceUntil: dayBefore.toISOString().slice(0, 10),
    },
    following: {
      ...series,
      ...changes,
      id: crypto.randomUUID(),
      startAt: changes.startAt ?? occurrence.toISOString(),
      recurrenceParentId: undefined,
      occurrenceOriginalStart: undefined,
      recurrenceExceptions: [],
      reminderNotifiedAt: undefined,
    },
  };
}
