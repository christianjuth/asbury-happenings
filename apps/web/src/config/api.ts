const DEFAULT_API_URL = "http://localhost:3101";

const API_URL = normalizeBaseUrl(
  import.meta.env.VITE_API_URL ?? DEFAULT_API_URL,
);

export function createApiUrl(path: string, baseUrl = API_URL): string {
  return new URL(path, `${normalizeBaseUrl(baseUrl)}/`).toString();
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
