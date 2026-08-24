import { Wordmark } from "@/components/wordmark";
import { createApiUrl } from "@/config/api";
import { ApiStatus } from "@/features/system-status/components/api-status";

const sections = [
  {
    number: "01",
    title: "Live music",
    description: "Shows, sets, and late nights from the boardwalk to downtown.",
    href: createApiUrl("/calendar"),
    linkLabel: "Open calendar",
  },
  {
    number: "02",
    title: "Happy hour",
    description: "A weekly guide to local food and drink specials around town.",
    href: createApiUrl("/happy-hours"),
    linkLabel: "Find a table",
  },
  {
    number: "03",
    title: "Community alerts",
    description: "Current public-safety notices collected into one local feed.",
    href: createApiUrl("/rss"),
    linkLabel: "View alerts",
  },
] as const;

export function HomePage() {
  const today = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="site-shell">
      <header className="site-header">
        <Wordmark />
        <ApiStatus />
      </header>

      <main>
        <section className="hero">
          <div className="hero__copy">
            <p className="eyebrow">Asbury Park, New Jersey</p>
            <h1>
              Find your next
              <span>good night.</span>
            </h1>
            <p className="hero__intro">
              A local field guide to music, food, and everything happening by
              the shore.
            </p>
            <div className="hero__actions">
              <a
                className="button button--primary"
                href={createApiUrl("/calendar")}
              >
                Browse the calendar
              </a>
              <a className="button button--text" href="#around-town">
                See what is around town
              </a>
            </div>
          </div>

          <aside className="today-card" aria-label={`Today is ${today}`}>
            <span className="today-card__label">Today by the shore</span>
            <strong>{today}</strong>
            <div className="today-card__sun" aria-hidden="true" />
            <span className="today-card__note">Plan something memorable.</span>
          </aside>
        </section>

        <section className="directory" id="around-town">
          <div className="section-heading">
            <p className="eyebrow">Around town</p>
            <h2>Start somewhere good.</h2>
          </div>

          <div className="directory__grid">
            {sections.map((section) => (
              <article className="directory-card" key={section.number}>
                <span className="directory-card__number">{section.number}</span>
                <div>
                  <h3>{section.title}</h3>
                  <p>{section.description}</p>
                </div>
                <a href={section.href}>
                  {section.linkLabel}
                  <span aria-hidden="true"> &rarr;</span>
                </a>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>Made for better days and later nights in Asbury Park.</p>
        <a href={createApiUrl("/health")}>System status</a>
      </footer>
    </div>
  );
}
