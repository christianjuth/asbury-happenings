import * as cheerio from "cheerio";
import ical from "ical-generator";

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  url: string;
}

export async function buildCalendarFeed(pageUrl: string): Promise<string> {
  const response = await fetch(pageUrl, {
    headers: {
      "user-agent": "chaotic-backend/0.1 calendar scraper"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${pageUrl}: ${response.status}`);
  }

  const html = await response.text();
  const events = extractEventsFromHtml(html, pageUrl);

  const calendar = ical({
    name: "Scraped Events",
    prodId: {
      company: "chaotic-backend",
      product: "webpage-calendar"
    }
  });

  for (const event of events) {
    calendar.createEvent({
      summary: event.title,
      start: event.start,
      end: event.end,
      url: event.url
    });
  }

  return calendar.toString();
}

export function extractEventsFromHtml(html: string, pageUrl: string): CalendarEvent[] {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim() || "Scraped webpage event";
  const start = new Date();
  start.setUTCHours(12, 0, 0, 0);

  const end = new Date(start);
  end.setUTCHours(13, 0, 0, 0);

  return [
    {
      title,
      start,
      end,
      url: pageUrl
    }
  ];
}
