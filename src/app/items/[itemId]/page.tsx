import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ExternalLink } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { QUALITY_TEXT_COLORS, SLOT_LABELS, wowheadItemUrl } from "@/lib/constants/wow";
import { ItemIcon } from "@/components/item-icon";
import { ItemLink } from "@/components/item-link";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { RoleBadge } from "@/components/role-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Params = { itemId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { itemId } = await params;
  const repo = await getRepo();
  const item = await repo.getItem(Number(itemId));
  return { title: item?.name ?? `Item #${itemId}` };
}

export default async function ItemPage({ params }: { params: Promise<Params> }) {
  const { itemId: itemIdRaw } = await params;
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(itemId) || itemId <= 0) notFound();

  const repo = await getRepo();
  const contention = await repo.getItemContention(itemId);
  if (!contention) notFound();
  const { item, itemName, wishers, awards, openCount } = contention;
  const quality = item?.quality ?? "common";
  const received = awards.filter((a) => !a.award.offspec && a.award.characterId !== null).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <ItemIcon icon={item?.icon} quality={quality} size={48} />
        <div className="min-w-0">
          <h1
            className="text-xl font-semibold tracking-tight"
            data-wowhead={`item=${itemId}&domain=tbc`}
          >
            <span style={{ color: QUALITY_TEXT_COLORS[quality] }}>{itemName}</span>
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="capitalize">{quality}</span>
            {item?.slot && <span>· {SLOT_LABELS[item.slot]}</span>}
            {item?.source && (
              <span>
                · {item.source.boss ? `${item.source.boss} — ` : ""}
                {item.source.zone}
              </span>
            )}
            {item?.phase && <Badge variant="secondary">P{item.phase}</Badge>}
            <a
              href={wowheadItemUrl(itemId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
            >
              Wowhead <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="tabular-nums">{wishers.length} want</Badge>
          <Badge variant="success" className="tabular-nums">{received} received</Badge>
          <Badge variant={openCount > 0 ? "warning" : "muted"} className="tabular-nums">
            {openCount} open
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Wishlisted by</CardTitle>
          <p className="text-xs text-muted-foreground">
            Open demand first, then fewest on-spec awards this phase — the council&apos;s priority order.
          </p>
        </CardHeader>
        <CardContent>
          {wishers.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No one has this on a wishlist.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Character</TableHead>
                  <TableHead>Wants for</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Currently using</TableHead>
                  <TableHead className="text-right">Awards this phase</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wishers.map((w) => (
                  <TableRow key={w.character.id}>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <CharacterLink name={w.character.name} wowClass={w.character.class} />
                        <ClassBadge wowClass={w.character.class} spec={w.character.spec} />
                      </span>
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {w.phases.map((p) => `P${p}`).join(", ")}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={w.character.role} />
                    </TableCell>
                    <TableCell>
                      {w.currentInSlot.length > 0 ? (
                        <span className="flex flex-wrap gap-x-3 gap-y-1">
                          {w.currentInSlot.map((s) => (
                            <CurrentItem key={`${s.slot}-${s.itemId}`} itemId={s.itemId} fallback={s.itemName} />
                          ))}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{w.onSpecAwardsActivePhase}</TableCell>
                    <TableCell>
                      {w.satisfied ? (
                        <Badge variant="success">Satisfied</Badge>
                      ) : (
                        <Badge variant="warning">Open</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Award history</CardTitle>
        </CardHeader>
        <CardContent>
          {awards.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Never awarded — has not dropped yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Winner</TableHead>
                  <TableHead>Raid</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {awards.map((a) => (
                  <TableRow key={a.award.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {format(parseISO(a.award.awardedAt), "d MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      {a.character ? (
                        <CharacterLink name={a.character.name} wowClass={a.character.class} />
                      ) : (
                        <Badge variant="warning">{a.award.rawWinnerName}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.session.zones.join(" + ")}
                    </TableCell>
                    <TableCell>
                      {a.award.offspec ? (
                        <Badge variant="warning">Off-spec</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Main spec</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.award.note ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Resolve a "currently using" item against the cache server-side. */
async function CurrentItem({ itemId, fallback }: { itemId: number; fallback: string }) {
  const repo = await getRepo();
  const item = await repo.getItem(itemId);
  return (
    <ItemLink
      item={{ itemId, name: item?.name ?? fallback, quality: item?.quality, icon: item?.icon }}
      size="sm"
      className="opacity-75"
    />
  );
}
