import { fetchCalendarEvents } from "../calendar/calendar.service.js";
import { SAMANTHA_DRESS_SOURCE } from "../calendar/config/samantha-dress.js";
import { ENV } from "../env.js";
import {
  createIndexNowService,
  type IndexNowLogger,
} from "./index-now.service.js";

// Manual full reconciliation: `pnpm indexnow`. Runs outside the server process,
// so it fetches the calendar directly instead of reading the warm cache.
const LOGGER: IndexNowLogger = {
  info: (details, message) => log("info", details, message),
  warn: (details, message) => log("warn", details, message),
  error: (details, message) => log("error", details, message),
};

function log(
  level: string,
  details: Record<string, unknown>,
  message: string,
): void {
  console.log(JSON.stringify({ level, message, ...details }));
}

const service = createIndexNowService({
  key: ENV.INDEXNOW_KEY,
  logger: LOGGER,
  trigger: "manual",
});

if (!service.enabled) {
  LOGGER.error({}, "INDEXNOW_KEY is not configured");
  process.exit(1);
}

const { events } = await fetchCalendarEvents(SAMANTHA_DRESS_SOURCE);

await service.submitDailyReconciliation(events);
