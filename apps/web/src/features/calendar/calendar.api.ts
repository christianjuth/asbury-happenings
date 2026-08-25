import { createApiUrl } from "@/config/api";
import { getJson } from "@/lib/http/get-json";
import type { CalendarEventsResponse } from "./calendar.types";

export function fetchCalendarEvents(
  signal: AbortSignal,
): Promise<CalendarEventsResponse> {
  return getJson<CalendarEventsResponse>(
    createApiUrl("/calendar/events"),
    signal,
  );
}
