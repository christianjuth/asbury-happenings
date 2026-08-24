import { describe, expect, it } from "vitest";
import { createApiUrl } from "./api";

describe("createApiUrl", () => {
  it("joins API paths without duplicate separators", () => {
    expect(createApiUrl("/health", "http://localhost:3101/")).toBe(
      "http://localhost:3101/health",
    );
  });
});
