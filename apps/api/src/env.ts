import { z } from "zod";

const ENV_SCHEMA = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3101),
  HOST: z.string().default("0.0.0.0"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3100"),
});

export const ENV = ENV_SCHEMA.parse(process.env);
