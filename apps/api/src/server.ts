import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { registerCalendarRoutes } from "./calendar/calendar.routes.js";

export async function buildServer() {
  const server = Fastify({
    logger: true
  });

  await server.register(sensible);

  server.get("/health", async () => ({
    ok: true
  }));

  await registerCalendarRoutes(server);

  return server;
}
