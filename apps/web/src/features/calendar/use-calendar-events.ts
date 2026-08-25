import { useEffect, useState } from "react";
import { fetchCalendarEvents } from "./calendar.api";
import type { CalendarEventsResponse } from "./calendar.types";

const WARMING_POLL_INTERVAL_MS = 1_000;
const ERROR_RETRY_INTERVAL_MS = 3_000;

export function useCalendarEvents(date: string) {
  const [data, setData] = useState<CalendarEventsResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    setLoading(true);
    setError(undefined);

    void fetchCalendarEvents(date, controller.signal)
      .then((response) => {
        setData(response);
        setLoading(false);

        if (response.resources.some((resource) => resource.loading)) {
          retryTimer = setTimeout(
            () => setRequestVersion((version) => version + 1),
            WARMING_POLL_INTERVAL_MS,
          );
        }
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load calendars.",
          );
          setLoading(false);
          retryTimer = setTimeout(
            () => setRequestVersion((version) => version + 1),
            ERROR_RETRY_INTERVAL_MS,
          );
        }
      });

    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [date, requestVersion]);

  return {
    data,
    error,
    loading,
    reload: () => setRequestVersion((version) => version + 1),
  };
}
