import { createApiUrl } from "@/config/api";
import { getJson } from "@/lib/http/get-json";
import type { CalendarEventsResponse } from "./calendar.types";

export function fetchCalendarEvents(
  date: string,
  signal: AbortSignal,
): Promise<CalendarEventsResponse> {
  const url = new URL(createApiUrl("/calendar/events"));

  url.searchParams.set("date", date);

  return getJson<CalendarEventsResponse>(url.toString(), signal);
}
