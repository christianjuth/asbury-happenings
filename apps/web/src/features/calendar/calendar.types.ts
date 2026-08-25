export interface CalendarResourceData {
  id: string;
  name: string;
  timeZone: string;
  loading: boolean;
  ready: boolean;
  subscriptionPath: string;
}

export interface CalendarEventData {
  id: string;
  resourceId: string;
  uid?: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description?: string;
  location?: string;
  address?: string;
  url?: string;
  status?: "confirmed" | "tentative" | "cancelled";
}

export interface CalendarEventsResponse {
  date: string;
  generatedAt: string;
  resources: CalendarResourceData[];
  events: CalendarEventData[];
}
