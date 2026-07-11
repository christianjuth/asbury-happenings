import dayjs, { type Dayjs } from "../calendar/calendar.dates.js";
import type { NixleSourceConfig } from "./nixle.config.js";
import { fetchNixleMessages, nixleMessagesToRss } from "./nixle.service.js";

const NIXLE_CACHE_TTL_MS = 5 * 60_000;

interface CachedNixleFeed {
  fetchedAt: Dayjs;
  rss: string;
}

const FEEDS = new Map<string, CachedNixleFeed>();

export async function getNixleRssFeed(
  config: NixleSourceConfig,
  now = dayjs(),
): Promise<string> {
  const cached = FEEDS.get(config.id);

  if (cached && now.diff(cached.fetchedAt) < NIXLE_CACHE_TTL_MS) {
    return cached.rss;
  }

  const messages = await fetchNixleMessages(config, now);
  const rss = nixleMessagesToRss(config, messages, now);

  FEEDS.set(config.id, {
    fetchedAt: now,
    rss,
  });

  return rss;
}

export function clearNixleRssCache(): void {
  FEEDS.clear();
}
