import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import {
  ResourcesDayView,
  type ScheduleEventData,
  type ScheduleResourceData,
} from "@mantine/schedule";
import { useState } from "react";
import { createApiUrl } from "@/config/api";
import dayjs from "@/lib/dates";
import {
  getCalendarDate,
  getCalendarScrollTime,
  getCalendarTime,
  toCalendarScheduleData,
} from "../calendar.adapter";
import type { CalendarScheduleEventPayload } from "../calendar.adapter";
import type { CalendarResourceData } from "../calendar.types";
import { useCalendarEvents } from "../use-calendar-events";

const DISPLAY_TIME_ZONE = "America/New_York";

export function CalendarBoard() {
  const { data, error, loading, reload } = useCalendarEvents();
  const today = getCalendarDate(DISPLAY_TIME_ZONE);
  const [date, setDate] = useState(today);
  const [selectedEvent, setSelectedEvent] = useState<ScheduleEventData | null>(
    null,
  );

  if (!data && loading) {
    return (
      <div className="calendar-state" role="status">
        <Loader color="orange" />
        <Text>Loading local calendars...</Text>
      </div>
    );
  }

  if (!data) {
    return (
      <Alert color="red" title="Calendars are unavailable">
        <Text mb="sm">{error ?? "The calendar feed could not be loaded."}</Text>
        <Button color="red" variant="light" onClick={reload}>
          Try again
        </Button>
      </Alert>
    );
  }

  const schedule = toCalendarScheduleData(data);
  const warmingCount = data.resources.filter(
    (resource) => !resource.ready,
  ).length;
  const selectedPayload = selectedEvent?.payload as
    CalendarScheduleEventPayload | undefined;

  return (
    <section
      className="calendar-board"
      aria-label="Asbury Park events calendar"
    >
      <Group className="calendar-board__heading" justify="space-between">
        <Group gap="xs" className="calendar-board__date-controls">
          <Button
            variant="default"
            disabled={date <= today}
            onClick={() =>
              setDate(dayjs(date).subtract(1, "day").format("YYYY-MM-DD"))
            }
          >
            Previous
          </Button>
          <Text fw={700} className="calendar-board__date">
            {dayjs(date).format("dddd, MMMM D")}
          </Text>
          <Button
            variant="default"
            onClick={() =>
              setDate(dayjs(date).add(1, "day").format("YYYY-MM-DD"))
            }
          >
            Next
          </Button>
          {date !== today && (
            <Button variant="subtle" onClick={() => setDate(today)}>
              Today
            </Button>
          )}
        </Group>
        <Group gap="md">
          <Text size="sm" c="dimmed" visibleFrom="sm">
            Events by venue and source
          </Text>
          <Button loading={loading} variant="default" onClick={reload}>
            Refresh
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="orange" mb="md" title="Refresh failed">
          Showing the last calendar data loaded in this tab.
        </Alert>
      )}

      {warmingCount > 0 && (
        <Alert color="yellow" mb="md" title="Some calendars are warming up">
          {warmingCount} {warmingCount === 1 ? "source is" : "sources are"}{" "}
          still loading. Ready calendars are shown now.
        </Alert>
      )}

      <div className="calendar-board__schedule">
        <ResourcesDayView
          date={date}
          resources={schedule.resources}
          events={schedule.events}
          withHeader={false}
          startTime="08:00:00"
          endTime="23:59:00"
          intervalMinutes={60}
          startScrollTime={getCalendarScrollTime(DISPLAY_TIME_ZONE)}
          slotWidth={108}
          rowHeight={76}
          maxEventsPerTimeSlot={3}
          radius={0}
          withCurrentTimeIndicator
          getCurrentTime={() => getCalendarTime(DISPLAY_TIME_ZONE)}
          scrollAreaProps={{ scrollbarSize: 10, offsetScrollbars: true }}
          renderResourceLabel={(resource) => (
            <ResourceLabel
              resource={resource}
              source={data.resources.find(
                (candidate) => candidate.id === String(resource.id),
              )}
            />
          )}
          onEventClick={(event) => setSelectedEvent(event)}
        />
      </div>

      <Modal
        opened={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
        title={selectedEvent?.title}
        centered
      >
        {selectedEvent && selectedPayload && (
          <Stack gap="sm">
            <Group gap="xs">
              <Badge color="teal" variant="light">
                {selectedPayload.resourceName}
              </Badge>
              {selectedPayload.status === "cancelled" && (
                <Badge color="gray">Cancelled</Badge>
              )}
            </Group>
            <Text fw={600}>
              {formatEventTime(selectedEvent, selectedPayload.allDay)}
            </Text>
            {selectedPayload.location && (
              <Text>{selectedPayload.location}</Text>
            )}
            {selectedPayload.address &&
              selectedPayload.address !== selectedPayload.location && (
                <Text c="dimmed" size="sm">
                  {selectedPayload.address}
                </Text>
              )}
            {selectedPayload.description && (
              <Text c="dimmed" size="sm" className="event-description">
                {selectedPayload.description}
              </Text>
            )}
            {selectedPayload.url && (
              <Anchor
                href={selectedPayload.url}
                target="_blank"
                rel="noreferrer"
              >
                Event details
              </Anchor>
            )}
          </Stack>
        )}
      </Modal>
    </section>
  );
}

function ResourceLabel({
  resource,
  source,
}: {
  resource: ScheduleResourceData;
  source: CalendarResourceData | undefined;
}) {
  if (!source) {
    return <Text size="sm">{resource.label}</Text>;
  }

  const feedUrl = createApiUrl(source.subscriptionPath);
  const subscriptionUrl = feedUrl.replace(/^https?:/, "webcal:");

  return (
    <Stack gap={3} align="flex-start" className="resource-label">
      <Text size="sm" fw={700} lh={1.2}>
        {source.name}
      </Text>
      <Group gap="xs">
        {!source.ready && (
          <Badge size="xs" color="yellow" variant="light">
            Warming
          </Badge>
        )}
        <Anchor
          href={subscriptionUrl}
          size="xs"
          onClick={(event) => event.stopPropagation()}
        >
          Subscribe
        </Anchor>
      </Group>
    </Stack>
  );
}

function formatEventTime(event: ScheduleEventData, allDay: boolean): string {
  if (allDay) {
    return `${dayjs(event.start).format("dddd, MMMM D")} - all day`;
  }

  return `${dayjs(event.start).format("dddd, MMMM D, h:mm A")} - ${dayjs(event.end).format("h:mm A")}`;
}
