import { buildServer } from "./server.js";
import { env } from "./env.js";

const server = await buildServer();

try {
  await server.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
