import { buildServer } from "./server.js";
import { ENV } from "./env.js";

const SERVER = await buildServer();

try {
  await SERVER.listen({ port: ENV.PORT, host: ENV.HOST });
} catch (error) {
  SERVER.log.error(error);
  process.exit(1);
}
