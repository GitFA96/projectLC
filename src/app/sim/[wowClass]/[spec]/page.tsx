import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { simConfigured } from "@/lib/sim/run";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import { specOptionKey, type SpecFingerprintRow } from "@/lib/sim/profile";
import type { IndividualSimSettings } from "@/lib/sim/request";
import type { WowClass } from "@/lib/types";
import { SimPanel } from "@/components/sim/sim-panel";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * One spec's workbench: its saved setup, and every kill it can be run against.
 *
 * The raider lives in the URL (`?player=`) rather than in React state, per
 * src/app/AGENTS.md — an officer pastes these links at another officer, and the
 * one thing that has to survive the paste is who is being looked at. The boss
 * and the kill stay client-side: they change on every dropdown press and nothing
 * rendered here depends on them.
 */

type Params = { wowClass: string; spec: string };
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { wowClass, spec } = await params;
  return { title: `${decodeURIComponent(spec)} ${decodeURIComponent(wowClass)} · Sim` };
}

export default async function SimSpecPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Search;
}) {
  const [{ wowClass: rawClass, spec: rawSpec }, sp] = await Promise.all([params, searchParams]);
  const wowClass = decodeURIComponent(rawClass);
  const spec = decodeURIComponent(rawSpec);

  const repo = await getRepo();
  const detail = await repo.getSimSpec(wowClass, spec);
  if (!detail) notFound();

  /*
   * Parsed here rather than in the browser so a corrupt blob degrades to "no
   * setup" — which the panel already knows how to offer a fix for — instead of
   * throwing inside a client component.
   */
  let profile: IndividualSimSettings | undefined;
  if (detail.profile) {
    try {
      profile = JSON.parse(detail.profile) as IndividualSimSettings;
    } catch {
      profile = undefined;
    }
  }

  const requested = Array.isArray(sp.player) ? sp.player[0] : sp.player;
  // A stale link to a raider who never played this spec falls back to nobody
  // chosen, rather than to an empty picker with a name in it.
  const player = detail.pulls.some((p) => p.actorName === requested) ? requested : undefined;
  const raiders = new Set(detail.pulls.map((p) => p.actorName));

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-2">
            <span style={{ color: CLASS_TEXT_COLORS[wowClass as WowClass] }}>{wowClass}</span>
            <span className="text-base font-normal text-muted-foreground">{spec}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={profile ? "success" : "outline"}>
              {profile ? "setup saved" : "no setup yet"}
            </Badge>
            <span>
              {detail.pulls.length} logged kill{detail.pulls.length === 1 ? "" : "s"} ·{" "}
              {raiders.size} raider{raiders.size === 1 ? "" : "s"}
            </span>
            {/* Which spec options wowsims itself attached — stated, not inferred. */}
            {profile && specOptionKey(profile) && (
              <span
                className="text-muted-foreground"
                title="The spec-options block wowsims put on this export."
              >
                wowsims calls it <code className="font-mono">{specOptionKey(profile)}</code>
              </span>
            )}
          </span>
        }
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/sim">
            <ArrowLeft className="h-3.5 w-3.5" /> All specs
          </Link>
        </Button>
      </PageHeader>

      {/*
        Keyed by raider: switching raider is a navigation, and remounting is what
        drops the previous comparison and pull selection. Without it the panel
        would keep showing one raider's result under another raider's name.
      */}
      <SimPanel
        key={player ?? "none"}
        wowClass={wowClass}
        spec={spec}
        pulls={detail.pulls}
        fingerprints={detail.fingerprints as SpecFingerprintRow[]}
        stranded={detail.stranded}
        configured={simConfigured()}
        hasProfile={profile !== undefined}
        player={player}
        profile={profile}
      />
    </div>
  );
}
