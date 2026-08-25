import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/schedule/styles.css";
import "@/app/styles.css";

import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/app";
import { theme } from "@/app/theme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <DatesProvider settings={{ locale: "en", firstDayOfWeek: 0 }}>
        <App />
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);
