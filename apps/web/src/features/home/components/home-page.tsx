import { ColorSchemeToggle } from "@/components/color-scheme-toggle";
import { CalendarBoard } from "@/features/calendar/components/calendar-board";

export function HomePage() {
  return (
    <div className="calendar-page">
      <header className="calendar-page__header">
        <div>
          <p className="eyebrow">Asbury Park, New Jersey</p>
          <h1>Local events calendar</h1>
        </div>
        <div className="calendar-page__controls">
          <ColorSchemeToggle />
        </div>
      </header>

      <main className="calendar-page__main">
        <CalendarBoard />
      </main>
    </div>
  );
}
