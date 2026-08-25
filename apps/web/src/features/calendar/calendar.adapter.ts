import type {
  ScheduleEventData,
  ScheduleResourceData,
} from "@mantine/schedule";
import dayjs from "@/lib/dates";
import type {
  CalendarEventData,
  CalendarEventsResponse,
} from "./calendar.types";

const DEFAULT_TIME_ZONE = "America/New_York";

export interface CalendarScheduleEventPayload {
  allDay: boolean;
  description?: string;
  location?: string;
  address?: string;
  url?: string;
  status?: CalendarEventData["status"];
  resourceName: string;
}

interface CalendarScheduleData {
  resources: ScheduleResourceData[];
  events: ScheduleEventData[];
}

export function toCalendarScheduleData(
  response: CalendarEventsResponse,
): CalendarScheduleData {
  const resourcesById = new Map(
    response.resources.map((resource) => [resource.id, resource]),
  );

  return {
    resources: response.resources.map((resource) => ({
      id: resource.id,
      label: resource.name,
      color: resource.ready ? "teal" : "gray",
    })),
    events: response.events.flatMap((event) => {
      const resource = resourcesById.get(event.resourceId);

      if (!resource) {
        return [];
      }

      const timeZone = resource.timeZone || DEFAULT_TIME_ZONE;
      const payload: CalendarScheduleEventPayload = {
        allDay: event.allDay,
        description: event.description,
        location: event.location,
        address: event.address,
        url: event.url,
        status: event.status,
        resourceName: resource.name,
      };

      return [
        {
          id: event.id,
          title:
            event.status === "cancelled"
              ? `${event.title} (cancelled)`
              : event.title,
          start: toScheduleDate(event.start, event.allDay, timeZone),
          end: toScheduleDate(event.end, event.allDay, timeZone),
          color: event.status === "cancelled" ? "gray" : "orange",
          variant: "light",
          resourceId: event.resourceId,
          payload,
        },
      ];
    }),
  };
}

export function getCalendarDate(timeZone = DEFAULT_TIME_ZONE): string {
  return dayjs().tz(timeZone).format("YYYY-MM-DD");
}

export function getCalendarTime(timeZone = DEFAULT_TIME_ZONE): string {
  return dayjs().tz(timeZone).format("YYYY-MM-DD HH:mm:ss");
}

export function getCalendarScrollTime(timeZone = DEFAULT_TIME_ZONE): string {
  return dayjs().tz(timeZone).format("HH:mm:ss");
}

function toScheduleDate(
  value: string,
  allDay: boolean,
  timeZone: string,
): string {
  if (allDay) {
    return `${value.slice(0, 10)} 00:00:00`;
  }

  return dayjs(value).tz(timeZone).format("YYYY-MM-DD HH:mm:ss");
}
