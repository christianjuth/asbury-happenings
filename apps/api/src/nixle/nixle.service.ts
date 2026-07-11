import * as cheerio from "cheerio";

import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import {
  normalizeText,
  resolveOptionalUrl,
} from "../calendar/calendar.utils.js";
import type { NixleSourceConfig } from "./nixle.config.js";

interface NixleMessage {
  title: string;
  link: string;
  priority?: string;
  enteredText?: string;
  publishedAt: Dayjs;
}

export async function fetchNixleMessages(
  config: NixleSourceConfig,
  now = dayjs(),
): Promise<NixleMessage[]> {
  const response = await fetch(config.url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "calendar-service nixle-rss",
    },
  });

  if (!response.ok) {
    throw new Error(`Nixle fetch failed with ${response.status}`);
  }

  return extractNixleMessages(await response.text(), config.url, now);
}

export function extractNixleMessages(
  html: string,
  sourceUrl: string,
  now = dayjs(),
): NixleMessage[] {
  const $ = cheerio.load(html);
  const candidates = $("#message_widget ol li")
    .filter((_, element) => !$(element).hasClass("last"))
    .toArray();
  const fallbackCandidates = $("li, article, .message, .message-item")
    .filter((_, element) =>
      Boolean($(element).find("a[href*='nixle.']").length),
    )
    .toArray();
  const elements = candidates.length ? candidates : fallbackCandidates;
  const messages: NixleMessage[] = [];
  const seenLinks = new Set<string>();

  for (const element of elements) {
    const item = $(element);
    const linkElement = item.find("a[href*='nixle.']").first();
    const link = resolveOptionalUrl(linkElement.attr("href"), sourceUrl);

    if (!link || seenLinks.has(link)) {
      continue;
    }

    const title = getMessageTitle(item, linkElement);

    if (!title) {
      continue;
    }

    const enteredText = normalizeEnteredText(item.find(".time").first().text());

    messages.push({
      title,
      link,
      priority:
        normalizeText(item.find(".priority").first().text()) || undefined,
      enteredText,
      publishedAt: approximatePublishedAt(enteredText, now),
    });
    seenLinks.add(link);
  }

  return messages;
}

export function nixleMessagesToRss(
  config: NixleSourceConfig,
  messages: NixleMessage[],
  now = dayjs(),
): string {
  const latestDate = messages[0]?.publishedAt ?? now;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "<channel>",
    xmlElement("title", `${config.name} Nixle Alerts`),
    xmlElement("link", config.url),
    xmlElement("description", `Recent Nixle messages from ${config.name}`),
    xmlElement("lastBuildDate", now.toDate().toUTCString()),
    xmlElement("pubDate", latestDate.toDate().toUTCString()),
    ...messages.flatMap((message) => [
      "<item>",
      xmlElement("title", message.title),
      xmlElement("link", message.link),
      xmlElement("guid", message.link),
      xmlElement("pubDate", message.publishedAt.toDate().toUTCString()),
      xmlElement("description", getMessageDescription(message)),
      "</item>",
    ]),
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}

function getMessageTitle(
  item: ReturnType<cheerio.CheerioAPI>,
  linkElement: ReturnType<cheerio.CheerioAPI>,
): string {
  const paragraph = linkElement.closest("p");

  if (paragraph.length) {
    const clone = paragraph.clone();

    clone.find("a").remove();
    return normalizeText(clone.text());
  }

  const clone = item.clone();

  clone.find("a, .priority, .time").remove();
  return normalizeText(clone.text());
}

function getMessageDescription(message: NixleMessage): string {
  return [message.priority, message.enteredText].filter(Boolean).join(" | ");
}

function normalizeEnteredText(value: string): string | undefined {
  const normalized = normalizeText(value)
    .replace(/^"|"$/g, "")
    .replace(/^Entered:\s*/i, "")
    .replace(/\s*"$/g, "")
    .trim();

  return normalized || undefined;
}

function approximatePublishedAt(
  enteredText: string | undefined,
  now: Dayjs,
): Dayjs {
  if (!enteredText) {
    return roundToNearestFiveMinutes(now);
  }

  let publishedAt = now;
  const pattern = /(\d+)\s+(week|day|hour|minute)s?/gi;
  let matched = false;

  for (const match of enteredText.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();

    if (!Number.isFinite(amount) || !unit) {
      continue;
    }

    matched = true;
    publishedAt = publishedAt.subtract(
      amount,
      unit as "week" | "day" | "hour" | "minute",
    );
  }

  return roundToNearestFiveMinutes(matched ? publishedAt : now);
}

function roundToNearestFiveMinutes(value: Dayjs): Dayjs {
  const roundedMinute = Math.round(value.minute() / 5) * 5;

  return value.second(0).millisecond(0).minute(0).add(roundedMinute, "minute");
}

function xmlElement(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
