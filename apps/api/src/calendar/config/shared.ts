import type { CalendarSourceConfig } from "../calendar.types.js";

export const SQUARESPACE_JSON_SOURCE = {
  sourceType: "json",
  fields: {
    title: "title",
    start: "startDate",
    end: "endDate",
    url: "fullUrl",
  },
  dateFormat: "epoch-ms",
} satisfies Partial<CalendarSourceConfig>;
