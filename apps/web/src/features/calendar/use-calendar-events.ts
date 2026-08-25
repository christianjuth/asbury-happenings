import { useEffect, useState } from "react";
import { fetchCalendarEvents } from "./calendar.api";
import type { CalendarEventsResponse } from "./calendar.types";

export function useCalendarEvents() {
  const [data, setData] = useState<CalendarEventsResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(undefined);

    void fetchCalendarEvents(controller.signal)
      .then((response) => {
        setData(response);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load calendars.",
          );
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [requestVersion]);

  return {
    data,
    error,
    loading,
    reload: () => setRequestVersion((version) => version + 1),
  };
}
