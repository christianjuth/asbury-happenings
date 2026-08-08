import type { CalendarEvent } from "../calendar/calendar.types.js";
import { extractEventsFromIcs } from "../calendar/ics.parser.js";
import { SAMANTHA_DRESS_SOURCE } from "./samantha-dress.config.js";

const SOURCE_FETCH_TIMEOUT_MS = 10_000;

let pendingFetch: Promise<CalendarEvent[]> | undefined;
let activeController: AbortController | undefined;

// Samantha Dress owns this upstream read instead of going through the generic
// calendar fetch/cache pipeline. The legacy ICS route therefore cannot change
// this service's cadence or failure behavior.
export function fetchSamanthaDressEvents(): Promise<CalendarEvent[]> {
  if (pendingFetch) {
    return pendingFetch;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(
        `Timed out fetching ${SAMANTHA_DRESS_SOURCE.url} after ${SOURCE_FETCH_TIMEOUT_MS}ms`,
      ),
    );
  }, SOURCE_FETCH_TIMEOUT_MS);

  activeController = controller;
  pendingFetch = fetch(SAMANTHA_DRESS_SOURCE.url, {
    signal: controller.signal,
  })
    .then(async (response) => {
      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${SAMANTHA_DRESS_SOURCE.url}: ${response.status}`,
        );
      }

      return extractEventsFromIcs(text, SAMANTHA_DRESS_SOURCE);
    })
    .finally(() => {
      clearTimeout(timeout);

      if (activeController === controller) {
        activeController = undefined;
        pendingFetch = undefined;
      }
    });

  return pendingFetch;
}

export function abortSamanthaDressFetch(): void {
  activeController?.abort(new Error("Samantha Dress source fetch aborted"));
}

export function clearSamanthaDressFetchState(): void {
  abortSamanthaDressFetch();
  activeController = undefined;
  pendingFetch = undefined;
}
