// Scheduling utility for auto-reply emails
// Handles office hours calculation and reply scheduling logic

export interface ScheduleResult {
  reply_status: "pending" | "scheduled";
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
        reply_status: "pending",
        reply_scheduled_at: null,
        send_immediately: true,
      };

    case "office_hours": {
      const nextOfficeHour = getNextOfficeHourSlot(now);
      const isWithinOfficeHours = isInOfficeHours(now);

      if (isWithinOfficeHours) {
        // Send immediately if we're in office hours
        return {
          reply_status: "pending",
          reply_scheduled_at: null,
          send_immediately: true,
        };
      }

      // Schedule for next office hour slot
      return {
        reply_status: "scheduled",
        reply_scheduled_at: nextOfficeHour.toISOString(),
        send_immediately: false,
      };
    }

    case "scheduled": {
      if (!scheduledFor) {
        throw new Error("scheduled_for is required when send_timing is 'scheduled'");
      }

      const scheduledDate = new Date(scheduledFor);
      const isPastDate = scheduledDate <= now;

      if (isPastDate) {
        throw new Error("scheduled_for must be in the future");
      }

      return {
        reply_status: "scheduled",
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
  // Convert to CEST timezone
  const cestDate = new Date(
    date.toLocaleString("en-US", { timeZone: OFFICE_HOURS.timezone }),
  );

  const dayOfWeek = cestDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const hour = cestDate.getHours();

  // Check if it's a work day
  if (!OFFICE_HOURS.workDays.includes(dayOfWeek)) {
    return false;
  }

  // Check if it's within office hours
  return hour >= OFFICE_HOURS.startHour && hour < OFFICE_HOURS.endHour;
}

/**
 * Calculates the next available office hour slot
 * If current time is outside office hours, returns the next valid slot
 */
export function getNextOfficeHourSlot(date: Date): Date {
  // Convert to CEST timezone
  const cestDate = new Date(
    date.toLocaleString("en-US", { timeZone: OFFICE_HOURS.timezone }),
  );

  let nextSlot = new Date(cestDate);
  const dayOfWeek = nextSlot.getDay();
  const hour = nextSlot.getHours();

  // If it's already within office hours, return current time
  if (isInOfficeHours(date)) {
    return date;
  }

  // If it's after office hours on a work day, move to next day at start hour
  if (
    OFFICE_HOURS.workDays.includes(dayOfWeek) &&
    hour >= OFFICE_HOURS.endHour
  ) {
    nextSlot.setDate(nextSlot.getDate() + 1);
    nextSlot.setHours(OFFICE_HOURS.startHour, 0, 0, 0);
    while (!OFFICE_HOURS.workDays.includes(nextSlot.getDay())) {
      nextSlot.setDate(nextSlot.getDate() + 1);
    }
  }
  // If it's before office hours on a work day, set to start hour today
  else if (
    OFFICE_HOURS.workDays.includes(dayOfWeek) &&
    hour < OFFICE_HOURS.startHour
  ) {
    nextSlot.setHours(OFFICE_HOURS.startHour, 0, 0, 0);
  }
  // If it's a weekend or non-work day, find next Monday
  else {
    // Move to next day
    nextSlot.setDate(nextSlot.getDate() + 1);
    nextSlot.setHours(OFFICE_HOURS.startHour, 0, 0, 0);

    // Keep moving forward until we hit a work day
    while (!OFFICE_HOURS.workDays.includes(nextSlot.getDay())) {
      nextSlot.setDate(nextSlot.getDate() + 1);
    }
  }

  // Convert back from CEST to UTC
  const utcOffset = nextSlot.getTimezoneOffset();
  const cestOffset = getCESTOffset(nextSlot);
  const offsetDiff = cestOffset - utcOffset;

  nextSlot.setMinutes(nextSlot.getMinutes() - offsetDiff);

  return nextSlot;
}

/**
 * Gets the CEST offset in minutes
 * CEST is UTC+2 (120 minutes)
 * CET is UTC+1 (60 minutes)
 */
function getCESTOffset(date: Date): number {
  // Create a date in CEST timezone
  const cestString = date.toLocaleString("en-US", {
    timeZone: OFFICE_HOURS.timezone,
  });
  const cestDate = new Date(cestString);

  // Calculate offset
  const utcDate = new Date(date.toUTCString());
  const diff = cestDate.getTime() - utcDate.getTime();

  return Math.round(diff / (1000 * 60));
}

/**
 * Formats a date for display in CEST timezone
 */
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

/**
 * Checks if a scheduled time is ready to be sent
 */
export function isReadyToSend(scheduledAt: string | null): boolean {
  if (!scheduledAt) {
    return true; // No schedule means send immediately
  }

  const scheduledDate = new Date(scheduledAt);
  const now = new Date();

  return now >= scheduledDate;
}
