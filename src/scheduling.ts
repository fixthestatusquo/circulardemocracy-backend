// Scheduling utility for auto-reply emails
// Handles office hours calculation and reply scheduling logic

export interface ScheduleResult {
  reply_scheduled_at: string | null;
  send_immediately: boolean;
}

export type SendTiming = "immediate" | "office_hours" | "scheduled";

/**
 * Office hours configuration
 * CEST timezone (Central European Summer Time)
 * Monday-Friday, 08:00-19:00
 */
const OFFICE_HOURS = {
  timezone: "Europe/Paris", // CEST
  startHour: 8,
  endHour: 19,
  workDays: [1, 2, 3, 4, 5], // Monday = 1, Friday = 5
};

/**
 * Calculates when a reply should be sent based on send_timing configuration
 */
export function calculateReplySchedule(
  sendTiming: SendTiming,
  scheduledFor?: string | null,
  receivedAt?: string,
): ScheduleResult {
  const now = receivedAt ? new Date(receivedAt) : new Date();

  switch (sendTiming) {
    case "immediate":
      return {
        reply_scheduled_at: null,
        send_immediately: true,
      };

    case "office_hours": {
      const nextOfficeHour = getNextOfficeHourSlot(now);
      const isWithinOfficeHours = isInOfficeHours(now);

      if (isWithinOfficeHours) {
        return {
          reply_scheduled_at: null,
          send_immediately: true,
        };
      }

      return {
        reply_scheduled_at: nextOfficeHour.toISOString(),
        send_immediately: false,
      };
    }

    case "scheduled": {
      if (!scheduledFor) {
        throw new Error(
          "scheduled_for is required when send_timing is 'scheduled'",
        );
      }

      const scheduledDate = new Date(scheduledFor);
      const isPastDate = scheduledDate <= now;

      if (isPastDate) {
        throw new Error("scheduled_for must be in the future");
      }

      return {
        reply_scheduled_at: scheduledDate.toISOString(),
        send_immediately: false,
      };
    }

    default:
      throw new Error(`Unknown send_timing: ${sendTiming}`);
  }
}

/**
 * Checks if a given date/time is within office hours
 */
export function isInOfficeHours(date: Date): boolean {
  const cestDate = new Date(
    date.toLocaleString("en-US", { timeZone: OFFICE_HOURS.timezone }),
  );

  const dayOfWeek = cestDate.getDay();
  const hour = cestDate.getHours();

  if (!OFFICE_HOURS.workDays.includes(dayOfWeek)) {
    return false;
  }

  return hour >= OFFICE_HOURS.startHour && hour < OFFICE_HOURS.endHour;
}

/**
 * Calculates the next available office hour slot
 */
export function getNextOfficeHourSlot(date: Date): Date {
  const cestDate = new Date(
    date.toLocaleString("en-US", { timeZone: OFFICE_HOURS.timezone }),
  );

  const nextSlot = new Date(cestDate);
  const dayOfWeek = nextSlot.getDay();
  const hour = nextSlot.getHours();

  if (isInOfficeHours(date)) {
    return date;
  }

  if (
    OFFICE_HOURS.workDays.includes(dayOfWeek) &&
    hour >= OFFICE_HOURS.endHour
  ) {
    nextSlot.setDate(nextSlot.getDate() + 1);
    nextSlot.setHours(OFFICE_HOURS.startHour, 0, 0, 0);
    while (!OFFICE_HOURS.workDays.includes(nextSlot.getDay())) {
      nextSlot.setDate(nextSlot.getDate() + 1);
    }
  } else if (
    OFFICE_HOURS.workDays.includes(dayOfWeek) &&
    hour < OFFICE_HOURS.startHour
  ) {
    nextSlot.setHours(OFFICE_HOURS.startHour, 0, 0, 0);
  } else {
    nextSlot.setDate(nextSlot.getDate() + 1);
    nextSlot.setHours(OFFICE_HOURS.startHour, 0, 0, 0);

    while (!OFFICE_HOURS.workDays.includes(nextSlot.getDay())) {
      nextSlot.setDate(nextSlot.getDate() + 1);
    }
  }

  const utcOffset = nextSlot.getTimezoneOffset();
  const cestOffset = getCESTOffset(nextSlot);
  const offsetDiff = cestOffset - utcOffset;

  nextSlot.setMinutes(nextSlot.getMinutes() - offsetDiff);

  return nextSlot;
}

function getCESTOffset(date: Date): number {
  const cestString = date.toLocaleString("en-US", {
    timeZone: OFFICE_HOURS.timezone,
  });
  const cestDate = new Date(cestString);

  const utcDate = new Date(date.toUTCString());
  const diff = cestDate.getTime() - utcDate.getTime();

  return Math.round(diff / (1000 * 60));
}

export function formatCESTTime(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: OFFICE_HOURS.timezone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** True when reply_scheduled_at is null (immediate) or the scheduled time has passed. */
export function isReadyToSend(scheduledAt: string | null): boolean {
  if (!scheduledAt) {
    return true;
  }

  return new Date() >= new Date(scheduledAt);
}
