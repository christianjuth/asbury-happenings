import { z } from "zod";

const ENV_SCHEMA = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0")
});

export const ENV = ENV_SCHEMA.parse(process.env);
