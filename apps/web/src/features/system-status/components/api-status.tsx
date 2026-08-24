import { useEffect, useState } from "react";
import { createApiUrl } from "@/config/api";
import { getJson } from "@/lib/http/get-json";

type ApiStatusValue = "checking" | "online" | "offline";

export function ApiStatus() {
  const [status, setStatus] = useState<ApiStatusValue>("checking");
  const healthUrl = createApiUrl("/health");

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi() {
      try {
        const health = await getJson<{ ok?: boolean }>(
          healthUrl,
          controller.signal,
        );

        setStatus(health.ok ? "online" : "offline");
      } catch {
        if (!controller.signal.aborted) {
          setStatus("offline");
        }
      }
    }

    void checkApi();

    return () => controller.abort();
  }, [healthUrl]);

  return (
    <a className={`api-status api-status--${status}`} href={healthUrl}>
      <span className="api-status__dot" aria-hidden="true" />
      API {status}
    </a>
  );
}
