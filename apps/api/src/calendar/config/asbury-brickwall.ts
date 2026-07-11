import { extractSmithMadeEvents } from "../calendar.post-processing.js";
import type { CalendarSourceConfig } from "../calendar.types.js";

export const ASBURY_BRICKWALL_SOURCE = {
  id: "asbury-brickwall",
  name: "Brickwall",
  sourceType: "html",
  url: "https://www.smithmade.org/events/date/{year}-{month}/location/brickwall",
  containerSelector: ".results > div",
  selectors: {
    title: ".event-info h2",
    startDate: ".date .type--h2",
  },
  timeZone: "America/New_York",
  defaultAddress: "Brickwall, 522 Cookman Ave, Asbury Park, NJ 07712",
  defaultDurationMinutes: 300,
  extractEvents: extractSmithMadeEvents,
} satisfies CalendarSourceConfig;
