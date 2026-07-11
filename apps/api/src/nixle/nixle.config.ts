export interface NixleSourceConfig {
  id: string;
  name: string;
  url: string;
  path: string;
}

export const NIXLE_SOURCES = [
  {
    id: "asbury-park-city",
    name: "City of Asbury Park NJ",
    url: "https://local.nixle.com/city-of-asbury-park-nj/",
    path: "/rss/asbury-park-city.xml",
  },
  {
    id: "asbury-park-police",
    name: "Asbury Park Police Department",
    url: "https://local.nixle.com/asbury-park-police-department/",
    path: "/rss/asbury-park-police.xml",
  },
] satisfies NixleSourceConfig[];

export function getNixleSource(id: string): NixleSourceConfig | undefined {
  return NIXLE_SOURCES.find((source) => source.id === id);
}
