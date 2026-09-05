import { DatabaseSync } from "node:sqlite";
/**
 * Class and boss guides, which have two owners and neither wins.
 *
 * An operator writes a baseline; a guild writes its own over the top. The
 * sources are kept as a list rather than a single string so the page can say
 * where each half came from — see change-chains §4k.
 */

export interface StoredGuide {
  /** 'class' | 'raid'. */
  kind: string;
  /** 'Warrior', 'Black Temple'. */
  subject: string;
  /** '' for the subject itself, else 'Fury' or 'Supremus'. */
  section: string;
  /** 'operator' for the shared baseline, else the guild's id. */
  owner: string;
  body: string;
  sources: string[];
  author?: string;
  updatedAt: string;
}

const splitSources = (raw: string | null): string[] =>
  (raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function getGuides(db: DatabaseSync): StoredGuide[] {
  const rows = db
    .prepare("SELECT kind, subject, section, owner, body, sources, author, updated_at FROM guides")
    .all() as {
    kind: string;
    subject: string;
    section: string;
    owner: string;
    body: string;
    sources: string | null;
    author: string | null;
    updated_at: string;
  }[];
  return rows.map((r) => ({
    kind: r.kind,
    subject: r.subject,
    section: r.section,
    owner: r.owner,
    body: r.body,
    sources: splitSources(r.sources),
    author: r.author ?? undefined,
    updatedAt: r.updated_at,
  }));
}

export function setGuide(
  db: DatabaseSync,
  guide: {
    kind: string;
    subject: string;
    section: string;
    owner: string;
    body: string;
    sources: string[];
    author?: string;
  },
): void {
  db.prepare(
    `INSERT INTO guides (kind, subject, section, owner, body, sources, author, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, subject, section, owner) DO UPDATE SET
       body = excluded.body, sources = excluded.sources,
       author = excluded.author, updated_at = excluded.updated_at`,
  ).run(
    guide.kind,
    guide.subject,
    guide.section,
    guide.owner,
    guide.body,
    guide.sources.join("\n") || null,
    guide.author ?? null,
    new Date().toISOString(),
  );
}

/** Remove a guide entirely — an empty one would read as "we have nothing to say". */
export function deleteGuide(
  db: DatabaseSync,
  kind: string,
  subject: string,
  section: string,
  owner: string,
): boolean {
  return (
    Number(
      db
        .prepare("DELETE FROM guides WHERE kind = ? AND subject = ? AND section = ? AND owner = ?")
        .run(kind, subject, section, owner).changes,
    ) > 0
  );
}
