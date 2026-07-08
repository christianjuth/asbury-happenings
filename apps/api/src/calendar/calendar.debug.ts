import lodash from "lodash";
import type { Dayjs } from "./calendar.dates.js";
import type { CalendarEvent, FetchStatus } from "./calendar.types.js";

type CalendarRevalidateStatus =
  "fresh" | "due" | "refetching" | "error" | "warming";

export interface CalendarDebugPage {
  sourceUrl: string;
  fetchStatus: FetchStatus;
  fetchedAt?: Dayjs;
  revalidateStatus: CalendarRevalidateStatus;
  revalidateAt?: Dayjs;
  error?: string;
}

export function eventsToDebugText(
  calendarName: string,
  sourceUrl: string | string[],
  events: CalendarEvent[],
  fetchStatus?: FetchStatus | FetchStatus[],
  debugPages?: CalendarDebugPage[],
): string {
  const sourceUrls = lodash.castArray(sourceUrl);
  const fetchStatuses = fetchStatus ? lodash.castArray(fetchStatus) : [];
  const lines = [
    `Calendar: ${calendarName}`,
    `Source: ${sourceUrls.join(", ")}`,
    `Fetch: upstream ${fetchStatuses.length ? fetchStatuses.join(", ") : "unknown"}`,
    `Events: ${events.length}`,
    "",
  ];

  if (debugPages?.length) {
    lines.push("Pages:");

    for (const [index, page] of debugPages.entries()) {
      lines.push(`${index + 1}. ${formatDebugPage(page)}`);
    }

    lines.push("");
  }

  for (const [index, event] of events.entries()) {
    lines.push(
      `#${index + 1} ${event.title}`,
      `Start: ${event.start.toISOString()}`,
      `End: ${event.end.toISOString()}`,
    );

    if (event.location) {
      lines.push(`Location: ${event.location}`);
    }

    if (event.address && event.address !== event.location) {
      lines.push(`Address: ${event.address}`);
    }

    if (event.url) {
      lines.push(`URL: ${event.url}`);
    }

    if (event.description) {
      lines.push(`Description: ${event.description}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function formatDebugPage(page: CalendarDebugPage): string {
  const fields = [
    `fetch ${page.fetchStatus}`,
    `snapshot ${page.fetchedAt ? page.fetchedAt.toISOString() : "none"}`,
    `revalidate ${formatRevalidateStatus(page)}`,
  ];

  if (page.error) {
    fields.push(`error ${page.error}`);
  }

  return fields.join(" | ");
}

function formatRevalidateStatus(page: CalendarDebugPage): string {
  if (page.revalidateStatus === "fresh" && page.revalidateAt) {
    return `fresh until ${page.revalidateAt.toISOString()}`;
  }

  if (page.revalidateStatus === "due" && page.revalidateAt) {
    return `due since ${page.revalidateAt.toISOString()}`;
  }

  return page.revalidateStatus;
}
