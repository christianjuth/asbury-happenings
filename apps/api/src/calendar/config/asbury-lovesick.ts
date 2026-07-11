import { extractSmithMadeEvents } from "../calendar.post-processing.js";
import type { CalendarSourceConfig } from "../calendar.types.js";

export const ASBURY_LOVESICK_SOURCE = {
  id: "asbury-lovesick",
  name: "Lovesick",
  sourceType: "html",
  url: "https://www.smithmade.org/events/date/{year}-{month}/location/lovesick",
  containerSelector: ".results > div",
  selectors: {
    title: ".event-info h2",
    startDate: ".date .type--h2",
  },
  timeZone: "America/New_York",
  defaultAddress: "Lovesick, 530 Cookman Ave, Asbury Park, NJ 07712",
  defaultDurationMinutes: 240,
  extractEvents: extractSmithMadeEvents,
} satisfies CalendarSourceConfig;
