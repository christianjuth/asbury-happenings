import { afterEach, describe, expect, it, vi } from "vitest";

import { createNominatimGeocoder } from "../src/geocode/nominatim.js";

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createGeocoder(fetchImpl: typeof fetch, overrides = {}) {
  return createNominatimGeocoder({
    logger: createLogger(),
    fetchImpl,
    // Real spacing is a second per request; tests keep the behavior and drop the
    // wait.
    minTimeMs: 0,
    retryBaseMs: 0,
    ...overrides,
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nominatim geocoder", () => {
  // Every other test here sets minTimeMs: 0 to stay fast, which means the
  // one-request-per-second floor — the politeness property Nominatim can block
  // us over — would otherwise have no coverage at all. This one pays the wait.
  // maxConcurrent alone does not give spacing: it serializes without pacing.
  it("holds requests at least a second apart", async () => {
    const startedAt: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      startedAt.push(Date.now());
      return jsonResponse([]);
    });
    const geocoder = createGeocoder(fetchImpl, { minTimeMs: 300 });

    await Promise.all([
      geocoder.geocode("one"),
      geocoder.geocode("two"),
      geocoder.geocode("three"),
    ]);

    expect(startedAt).toHaveLength(3);

    const gaps = startedAt
      .slice(1)
      .map((value, index) => value - (startedAt[index] as number));

    // Deliberately loose. Bottleneck spaces job *launches*, while this measures
    // the fetch call an async hop later, so a busy event loop jitters the
    // observed gap in both directions — asserting close to minTime makes this
    // flaky under parallel test load. A floor well above zero still fails hard
    // if the limiter is removed, which is the regression worth catching.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(120);
    }

    await geocoder.stop();
  });

  it("sends the documented query with the required identifying headers", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse([
          { lat: "39.6423", lon: "-74.1815", address: { city: "Ship Bottom" } },
        ]),
      );

    const result = await createGeocoder(fetchImpl).geocode(
      "100 Ocean Ave, Ship Bottom, NJ",
    );

    expect(result).toEqual({
      kind: "resolved",
      coordinates: { lat: 39.6423, lon: -74.1815 },
      address: { city: "Ship Bottom" },
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const parsed = new URL(String(url));

    expect(parsed.origin + parsed.pathname).toBe(
      "https://nominatim.openstreetmap.org/search",
    );
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      format: "json",
      limit: "1",
      // Required to validate the answer's city and state at all.
      addressdetails: "1",
      countrycodes: "us",
      q: "100 Ocean Ave, Ship Bottom, NJ",
    });
    // Nominatim's policy requires a descriptive User-Agent naming the
    // application with a contact address. Asserted by shape rather than exact
    // string, so changing the contact does not fail an unrelated test.
    const headers = init?.headers as Record<string, string>;

    expect(headers["accept"]).toBe("application/json");
    expect(headers["user-agent"]).toMatch(/samanthadress\.com.*@/);
  });

  it("reports an empty result set as a real negative", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([]));

    expect(await createGeocoder(fetchImpl).geocode("nowhere")).toEqual({
      kind: "no-result",
    });
  });

  it.each([
    ["a schema mismatch", jsonResponse([{ lat: 39.6423, lon: -74.1815 }])],
    ["unusable coordinates", jsonResponse([{ lat: "north", lon: "west" }])],
  ])(
    "treats %s as a failure rather than a negative",
    async (_label, response) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);

      expect(
        (await createGeocoder(fetchImpl).geocode("100 Ocean Ave")).kind,
      ).toBe("failed");
    },
  );

  it("retries a rate limit and returns the eventual answer", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Too many requests", { status: 429 }))
      .mockResolvedValueOnce(
        jsonResponse([{ lat: "39.6423", lon: "-74.1815" }]),
      );

    const result = await createGeocoder(fetchImpl).geocode("100 Ocean Ave");

    expect(result.kind).toBe("resolved");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up on a rate limit that does not clear", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Too many requests", { status: 429 }));

    const result = await createGeocoder(fetchImpl, {
      maxAttempts: 2,
    }).geocode("100 Ocean Ave");

    expect(result).toMatchObject({ kind: "failed" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // A 400 means the request itself is wrong. Repeating it just spends requests
  // against a ceiling we care about.
  it("does not retry a non-throttling client error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Bad request", { status: 400 }));

    const result = await createGeocoder(fetchImpl).geocode("100 Ocean Ave");

    expect(result).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("http 400"),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // Which status means "this address is hopeless" versus "the provider is
  // refusing us" decides whether the caller caches a negative for a week. 403 is
  // what Nominatim returns for a blocked IP, so getting it wrong blanks every
  // venue over a block that may lift in minutes. We build every part of the URL
  // except the query string, so only a 400 can implicate the address.
  it.each([
    [400, "address"],
    [403, "provider"],
    [401, "provider"],
    [404, "provider"],
    [429, "transient"],
    [500, "transient"],
    [503, "transient"],
  ])("classifies http %i as a %s failure", async (status, failure) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status }));

    const result = await createGeocoder(fetchImpl, { maxAttempts: 1 }).geocode(
      "100 Ocean Ave",
    );

    expect(result).toMatchObject({ kind: "failed", failure });
  });

  // A 200 whose payload is unusable is the provider answering, not the provider
  // struggling. Retrying fetches the same bytes and burns the request ceiling
  // twice more before the run's failure counter gives up on the queue.
  it("does not retry a well-formed response with an unusable payload", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([{ lat: "not-a-number", lon: "0" }]));

    const result = await createGeocoder(fetchImpl).geocode("100 Ocean Ave");

    expect(result).toMatchObject({
      kind: "failed",
      reason: "result had unusable coordinates",
      failure: "provider",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a response that does not match the schema", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ unexpected: "shape" }));

    const result = await createGeocoder(fetchImpl).geocode("100 Ocean Ave");

    expect(result).toMatchObject({
      kind: "failed",
      reason: "unexpected response shape",
      failure: "provider",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a network failure without throwing", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("socket hang up"));

    expect(
      await createGeocoder(fetchImpl, { maxAttempts: 1 }).geocode(
        "100 Ocean Ave",
      ),
    ).toEqual({
      kind: "failed",
      reason: "socket hang up",
      // A transport error has not ruled the address out, so it is worth another
      // attempt — unlike a malformed payload.
      failure: "transient",
    });
  });

  // The 1 request/second ceiling is absolute, so concurrent callers still have to
  // come out serialized.
  it("serializes concurrent lookups", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      return jsonResponse([{ lat: "39.6423", lon: "-74.1815" }]);
    });
    const geocoder = createGeocoder(fetchImpl);

    await Promise.all([
      geocoder.geocode("one"),
      geocoder.geocode("two"),
      geocoder.geocode("three"),
    ]);

    expect(maxInFlight).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await geocoder.stop();
  });
});
