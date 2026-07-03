import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("server", () => {
  it("returns health status", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true
    });

    await server.close();
  });
});
