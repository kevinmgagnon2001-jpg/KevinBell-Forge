/**
 * The Catalog (catalog.ts): every game, toy, shape, colour, effect, sky, gauge and move, in folding
 * sections with a search, plus what is in the world right now. Tap an entry and it runs as the same
 * plain request you could type, so no model is needed. Entries and things that are new since you
 * last looked carry a "new" mark. The book bubble by the view buttons opens it; so does B.
 */
import { BookOpen, Crosshair, Play, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CATALOG, CATALOG_VERSION, SECTIONS, isNew, searchCatalog, worldRows, type CatalogItem } from "@/engine/catalog";
import { useForge } from "@/engine/store";

const SEEN_KEY = "forge-catalog-seen";

type Seen = { v: number; id: number };

function readSeen(): Seen {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? "null") as Partial<Seen> | null;
    // First time: the catalog itself is new, but the lab you start in is not.
    return { v: typeof raw?.v === "number" ? raw.v : 1, id: typeof raw?.id === "number" ? raw.id : 20 };
  } catch {
    return { v: 1, id: 20 };
  }
}

function writeSeen(seen: Seen) {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* private mode: the marks just stay */
  }
}

let open = false;
const listeners = new Set<() => void>();
const setOpen = (on: boolean) => {
  open = on;
  listeners.forEach((notify) => notify());
};
const useOpen = () =>
  useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => open,
    () => false,
  );

/** The book bubble; a glowing dot when something is new. */
export function CatalogButton() {
  const on = useOpen();
  const nextId = useForge((s) => s.nextId);
  const [seen, setSeen] = useState<Seen>(() => readSeen());
  useEffect(() => {
    if (!on) setSeen(readSeen());
  }, [on]);
  const fresh = seen.v < CATALOG_VERSION || nextId - 1 > seen.id;
  return (
    <button type="button" className={`bubble-icon catalog-button ${on ? "is-on" : ""}`} aria-expanded={on} aria-label="Catalog" title="Catalog: games, toys and everything you can make (B)" onClick={() => setOpen(!on)}>
      <BookOpen aria-hidden="true" />
      {fresh && !on ? <span className="catalog-dot" aria-hidden="true" /> : null}
    </button>
  );
}

export function CatalogOverlay() {
  const on = useOpen();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || event.repeat) return;
      if (event.code === "KeyB") setOpen(!open);
      if (event.code === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return on ? <CatalogPanel /> : null;
}

function CatalogPanel() {
  const [query, setQuery] = useState("");
  const [seen] = useState<Seen>(() => readSeen());
  const [ran, setRan] = useState("");
  const entities = useForge((s) => s.entities);
  const selectedId = useForge((s) => s.selectedId);
  const busy = useForge((s) => s.busy);
  const hits = useMemo(() => searchCatalog(query), [query]);
  const groups = useMemo(() => worldRows({ entities }, seen.id), [entities, seen.id]);
  const newCount = CATALOG.filter((item) => isNew(item, seen.v)).length;
  const freshThings = groups.reduce((n, g) => n + g.rows.filter((r) => r.fresh).length, 0);

  // Closing marks everything as seen.
  useEffect(
    () => () => {
      const top = Math.max(0, ...Object.keys(useForge.getState().entities).map(Number));
      writeSeen({ v: CATALOG_VERSION, id: top });
    },
    [],
  );

  const run = (item: CatalogItem) => {
    if (busy) return;
    setRan(item.id);
    void useForge.getState().submitIntent(item.intent);
    window.setTimeout(() => setRan((id) => (id === item.id ? "" : id)), 1400);
  };
  const find = (id: number) => {
    useForge.getState().select(id);
    void useForge.getState().submitIntent(`where is #${id}`);
  };

  const searching = query.trim().length > 0;
  return (
    <section className="catalog" aria-label="Catalog">
      <header className="catalog-head">
        <BookOpen aria-hidden="true" className="catalog-mark" />
        <strong>Catalog</strong>
        {newCount + freshThings > 0 ? <span className="catalog-new">{newCount + freshThings} new</span> : null}
        <button type="button" className="bubble-icon catalog-close" aria-label="Close catalog" title="Close (Esc)" onClick={() => setOpen(false)}>
          <X aria-hidden="true" />
        </button>
      </header>
      <label className="catalog-search">
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search: fire, arcade, gem, rain…" aria-label="Search the catalog" autoComplete="off" />
      </label>
      <div className="catalog-scroll">
        {SECTIONS.map((section) => {
          const items = hits.filter((item) => item.section === section.id);
          if (!items.length) return null;
          const fresh = items.filter((item) => isNew(item, seen.v)).length;
          return (
            <details key={section.id} className="catalog-section" open={searching || section.id === "games" || fresh > 0}>
              <summary>
                <span className="catalog-glyph" aria-hidden="true">{section.glyph}</span>
                <span className="catalog-title">{section.name}</span>
                <span className="catalog-count">{items.length}</span>
                {fresh ? <span className="catalog-new">{fresh} new</span> : null}
              </summary>
              <p className="catalog-blurb">{section.blurb}</p>
              <div className="catalog-grid">
                {items.map((item) => (
                  <button key={item.id} type="button" className={`catalog-card ${ran === item.id ? "is-ran" : ""}`} onClick={() => run(item)} disabled={busy} title={`“${item.intent}”`}>
                    <span className="catalog-glyph" aria-hidden="true">{item.glyph}</span>
                    <span className="catalog-card-text">
                      <span className="catalog-card-name">
                        {item.name}
                        {isNew(item, seen.v) ? <span className="catalog-new">new</span> : null}
                      </span>
                      <span className="catalog-card-blurb">{item.blurb}</span>
                    </span>
                    <Play aria-hidden="true" className="catalog-go" />
                  </button>
                ))}
              </div>
            </details>
          );
        })}
        {!searching ? (
          <details className="catalog-section" open={freshThings > 0}>
            <summary>
              <span className="catalog-glyph" aria-hidden="true">🗺</span>
              <span className="catalog-title">In this world</span>
              <span className="catalog-count">{groups.reduce((n, g) => n + g.rows.length, 0)}</span>
              {freshThings ? <span className="catalog-new">{freshThings} new</span> : null}
            </summary>
            <p className="catalog-blurb">Everything here now. Find one to select it and hear where it is.</p>
            {groups.map((group) => (
              <details key={group.kind} className="catalog-sub" open={group.rows.some((r) => r.fresh)}>
                <summary>
                  <span className="catalog-title">{group.kind}</span>
                  <span className="catalog-count">{group.rows.length}</span>
                </summary>
                <ul className="catalog-rows">
                  {group.rows.map((row) => (
                    <li key={row.id} className={row.id === selectedId ? "is-selected" : ""}>
                      <span className="catalog-row-name">
                        {row.name}
                        {row.fresh ? <span className="catalog-new">new</span> : null}
                      </span>
                      <button type="button" className="bubble-icon catalog-find" aria-label={`Find ${row.name}`} title={`Find ${row.name}`} onClick={() => find(row.id)}>
                        <Crosshair aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </details>
        ) : null}
        {searching && !hits.length ? <p className="catalog-blurb">Nothing matches. Try a single word, like “ball” or “night”.</p> : null}
      </div>
    </section>
  );
}
