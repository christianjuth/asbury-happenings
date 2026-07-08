export interface HappyHourSourceConfig {
  id: string;
  name: string;
  url: string;
  timeZone: string;
}

export const HAPPY_HOUR_SOURCE: HappyHourSourceConfig = {
  id: "asbury-park",
  name: "Asbury Park Happy Hours",
  url: "https://asburypark.rectalogic.com/#restaurant-happy-hours",
  timeZone: "America/New_York",
};
