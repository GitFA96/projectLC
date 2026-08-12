"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Check, Copy, Crown, Link2, Loader2, Mail, UserMinus, X } from "lucide-react";
import Link from "next/link";
import {
  addOwnerAction,
  issueInviteAction,
  linkCharacterAction,
  removeMemberAction,
  removeOwnerAction,
  revokeInviteAction,
  setMemberRolesAction,
  unlinkCharacterAction,
  type MembersActionResult,
} from "@/app/roster/members/actions";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MembersView, MemberRow, InviteRow } from "@/lib/analysis/members";

/**
 * Who is in this guild, and who has been asked.
 *
 * The screen is built around one asymmetry: an invite code exists **once**, in
 * the response that created it. Only its hash is stored, so there is no "show
 * it again" and the UI has to make that obvious at the moment it matters rather
 * than explain it afterwards.
 */

function relative(iso: string | null): string {
  if (!iso) return "never";
  try {
    return `${formatDistanceToNowStrict(parseISO(iso))} ago`;
  } catch {
    return "unknown";
  }
}

/** Shared result line under whichever control was last used. */
function ResultLine({ result }: { result: MembersActionResult | null }) {
  if (!result) return null;
  return (
    <p className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
      {result.message}
    </p>
  );
}

/**
 * The code, shown once.
 *
 * Deliberately loud and deliberately not dismissible by accident: closing this
 * is the only way to lose it, and losing it means issuing a new invitation.
 */
function IssuedCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [copied, setCopied] = React.useState<"code" | "link" | null>(null);

  /*
   * The origin is read at click time rather than at render.
   *
   * A server-rendered component has no `window`, so reading it during render
   * would either throw or produce markup the client immediately contradicts.
   * Nothing here needs it until somebody actually clicks.
   */
  const copy = async (what: "code" | "link") => {
    const text = what === "code" ? code : `${window.location.origin}/join?code=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard refused (no permission, insecure origin). The code is on
      // screen and selectable, so this is a convenience failing, not the flow.
      setCopied(null);
    }
  };

  return (
    <div className="rounded-md border border-warn-line bg-warn-soft p-3">
      <p className="text-xs font-medium text-warn-ink">
        Copy this now — it is stored only as a hash and cannot be shown again.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded bg-background px-2 py-1 font-mono text-sm tracking-wider select-all">
          {code}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={() => copy("code")}>
          {copied === "code" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === "code" ? "Copied" : "Copy code"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => copy("link")}>
          {copied === "link" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === "link" ? "Copied" : "Copy join link"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      <p className="mt-2 text-xs text-warn-ink">
        Send it to them privately — a direct message, not a guild channel. Anyone holding it can
        claim that character.
      </p>
    </div>
  );
}

/* --- Inviting ----------------------------------------------------------- */

function InviteForm({ view }: { view: MembersView }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [characterId, setCharacterId] = React.useState("");
  const [roleIds, setRoleIds] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<MembersActionResult | null>(null);
  const [code, setCode] = React.useState<string | null>(null);

  const grantable = view.roles.filter((r) => !r.baseline);
  const baseline = view.roles.find((r) => r.baseline);

  const submit = () => {
    if (!characterId) return;
    setResult(null);
    setCode(null);
    startTransition(async () => {
      const next = await issueInviteAction(characterId, roleIds);
      setResult(next);
      if (next.ok) {
        setCode(next.code ?? null);
        setCharacterId("");
        setRoleIds([]);
        router.refresh();
      }
    });
  };

  if (view.unclaimed.length === 0 && !code) {
    return (
      <p className="text-sm text-muted-foreground">
        Every character on the roster is either claimed or already invited.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {code && <IssuedCode code={code} onDone={() => setCode(null)} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="invite-character">Character</Label>
          <Select value={characterId} onValueChange={setCharacterId}>
            <SelectTrigger id="invite-character">
              <SelectValue placeholder="Who is this for?" />
            </SelectTrigger>
            <SelectContent>
              {view.unclaimed.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Only characters nobody has claimed and nobody is already waiting on.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Roles they arrive with</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {grantable.length === 0 && (
              <p className="text-xs text-muted-foreground">This guild has no roles beyond the baseline yet.</p>
            )}
            {grantable.map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={roleIds.includes(role.id)}
                  onChange={(e) =>
                    setRoleIds((prev) =>
                      e.target.checked ? [...prev, role.id] : prev.filter((r) => r !== role.id),
                    )
                  }
                />
                {role.name}
              </label>
            ))}
          </div>
          {baseline && (
            <p className="text-xs text-muted-foreground">
              Everyone also holds <span className="font-medium">{baseline.name}</span>, whatever you pick here.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={!characterId || pending} onClick={submit}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          Create invitation
        </Button>
        {!code && <ResultLine result={result} />}
      </div>
    </div>
  );
}

function PendingInvites({ invites }: { invites: InviteRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<MembersActionResult | null>(null);

  const revoke = (id: string) => {
    setResult(null);
    startTransition(async () => {
      const next = await revokeInviteAction(id);
      setResult(next);
      if (next.ok) router.refresh();
    });
  };

  if (invites.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody is waiting on an invitation.</p>;
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>For</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invites.map((invite) => (
            <TableRow key={invite.id}>
              <TableCell>
                {invite.characterName && invite.wowClass ? (
                  <CharacterLink name={invite.characterName} wowClass={invite.wowClass} />
                ) : (
                  // The character was deleted after the invite went out. The row
                  // still renders: history is unlinked, never destroyed.
                  <span className="text-muted-foreground italic">character removed</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {invite.roleNames.length > 0 ? invite.roleNames.join(", ") : "baseline only"}
              </TableCell>
              <TableCell>
                {invite.state === "expired" ? (
                  <Badge variant="muted">expired</Badge>
                ) : (
                  <span className="text-muted-foreground">in {relative(invite.expiresAt).replace(" ago", "")}</span>
                )}
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => revoke(invite.id)}
                  title="Withdraw this invitation"
                >
                  <X className="h-3.5 w-3.5" />
                  Withdraw
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ResultLine result={result} />
    </div>
  );
}

/* --- Which roles somebody holds ----------------------------------------- */

/**
 * Hand out the roles the guild has already agreed on.
 *
 * Deliberately only the *assignment*: what a role grants is decided on
 * /guild/roles, behind `roles.manage`. Somebody trusted to say "Kremert is an
 * officer" is not automatically trusted to redefine what an officer may do —
 * that second power is guild-master-equivalent.
 */
function MemberRoles({ member, roles }: { member: MemberRow; roles: MembersView["roles"] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>(member.roles.map((r) => r.id));
  const [result, setResult] = React.useState<MembersActionResult | null>(null);

  // The baseline is held by everybody without being given to anybody, so
  // offering it as a choice would suggest it could be withheld.
  const grantable = roles.filter((r) => !r.baseline);

  if (member.isGuildMaster) {
    return (
      <span className="text-sm text-muted-foreground" title="Owners hold every capability implicitly">
        everything
      </span>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {member.roles.length > 0 ? (
          member.roles.map((role) => (
            <Badge key={role.id} variant="secondary">
              {role.name}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">baseline only</span>
        )}
        {grantable.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setPicked(member.roles.map((r) => r.id));
              setOpen(true);
            }}
          >
            Change
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {grantable.map((role) => (
          <label key={role.id} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={picked.includes(role.id)}
              disabled={pending}
              onChange={(e) =>
                setPicked((prev) => (e.target.checked ? [...prev, role.id] : prev.filter((r) => r !== role.id)))
              }
            />
            {role.name}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const next = await setMemberRolesAction(member.membershipId, picked);
              setResult(next);
              if (next.ok) {
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <ResultLine result={result} />
    </div>
  );
}

/* --- Who plays what ----------------------------------------------------- */

function LinkCharacter({ member, unclaimed }: { member: MemberRow; unclaimed: MembersView["unclaimed"] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [characterId, setCharacterId] = React.useState("");
  const [result, setResult] = React.useState<MembersActionResult | null>(null);

  const run = (fn: () => Promise<MembersActionResult>) => {
    setResult(null);
    startTransition(async () => {
      const next = await fn();
      setResult(next);
      if (next.ok) {
        setOpen(false);
        setCharacterId("");
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {member.characters.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            <ClassBadge wowClass={c.wowClass} />
            <CharacterLink name={c.name} wowClass={c.wowClass} className="text-sm" />
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              title={`Unlink ${c.name} — the character and its awards are untouched`}
              disabled={pending}
              onClick={() => run(() => unlinkCharacterAction(c.id))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {member.characters.length === 0 && (
          <span className="text-sm text-muted-foreground italic">no character linked</span>
        )}
        {!open && unclaimed.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
            <Link2 className="h-3.5 w-3.5" />
            Link
          </Button>
        )}
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={characterId} onValueChange={setCharacterId}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Which character?" />
            </SelectTrigger>
            <SelectContent>
              {unclaimed.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={!characterId || pending}
            onClick={() => run(() => linkCharacterAction(characterId, member.membershipId))}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Link
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
      <ResultLine result={result} />
    </div>
  );
}

/* --- Leaving, and who owns the place ------------------------------------ */

/**
 * The destructive column, which destroys nothing.
 *
 * Removing a member unlinks their characters and deletes the membership. Every
 * award they won stays exactly where it is (invariant 6) — which is what makes
 * a two-click confirm proportionate rather than a modal with a typed name.
 *
 * Ownership controls appear only for an owner, because ownership is not a
 * capability and there is nothing `members.manage` should be able to do to it.
 */
function MemberControls({
  member,
  viewerIsOwner,
  viewerMembershipId,
  ownerCount,
}: {
  member: MemberRow;
  viewerIsOwner: boolean;
  viewerMembershipId: string | null;
  ownerCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirm, setConfirm] = React.useState(false);
  const [result, setResult] = React.useState<MembersActionResult | null>(null);

  const run = (fn: () => Promise<MembersActionResult>) => {
    setResult(null);
    setConfirm(false);
    startTransition(async () => {
      const next = await fn();
      setResult(next);
      if (next.ok) router.refresh();
    });
  };

  const isMe = member.membershipId === viewerMembershipId;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        {viewerIsOwner && !member.isGuildMaster && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            title="Co-owners hold everything, always. Nobody loses anything by this."
            onClick={() => run(() => addOwnerAction(member.membershipId))}
          >
            <Crown className="h-3.5 w-3.5" />
            Make owner
          </Button>
        )}

        {viewerIsOwner && member.isGuildMaster && ownerCount > 1 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            title={
              isMe
                ? "Step down. Your membership and characters are unchanged."
                : "Only possible once they have been quiet for the guild's succession window."
            }
            onClick={() => run(() => removeOwnerAction(member.membershipId))}
          >
            {isMe ? "Step down" : "Remove ownership"}
          </Button>
        )}

        {!member.isGuildMaster && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => (confirm ? run(() => removeMemberAction(member.membershipId)) : setConfirm(true))}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus className="h-3.5 w-3.5" />}
            {confirm ? "Really remove?" : "Remove"}
          </Button>
        )}
      </div>
      {confirm && (
        <p className="text-xs text-muted-foreground">
          Their characters become unclaimed. Awards, attendance and history are untouched.
        </p>
      )}
      <ResultLine result={result} />
    </div>
  );
}

/* --- The screen --------------------------------------------------------- */

export function MembersScreen({
  view,
  authEnabled,
  viewerIsOwner,
  viewerMembershipId,
}: {
  view: MembersView;
  authEnabled: boolean;
  viewerIsOwner: boolean;
  viewerMembershipId: string | null;
}) {
  return (
    <div className="space-y-6">
      {!authEnabled && (
        <div className="rounded-md border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink">
          <span className="font-medium">Sign-in is switched off for this deployment.</span> Everything
          on this page works and is saved, but nobody has to log in to use the app yet, so these
          memberships grant nothing until <code className="font-mono text-xs">PROJECTLC_AUTH</code> is
          turned on.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {view.members.length} {view.members.length === 1 ? "member" : "members"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Plays</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.members.map((member) => (
                <TableRow key={member.membershipId}>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{member.displayName}</span>
                      {member.isGuildMaster && (
                        <Badge variant="warning" title="Owners hold every capability, always">
                          <Crown className="h-3 w-3" />
                          owner
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <MemberRoles member={member} roles={view.roles} />
                  </TableCell>
                  <TableCell>
                    <LinkCharacter member={member} unclaimed={view.unclaimed} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {relative(member.lastSeenAt)}
                  </TableCell>
                  <TableCell>
                    <MemberControls
                      member={member}
                      viewerIsOwner={viewerIsOwner}
                      viewerMembershipId={viewerMembershipId}
                      ownerCount={view.ownerCount}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        What each role is allowed to do is decided on the{" "}
        <Link href="/guild/roles" className="underline underline-offset-2">
          roles page
        </Link>
        .
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Invite somebody</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm view={view} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waiting to arrive</CardTitle>
        </CardHeader>
        <CardContent>
          <PendingInvites invites={view.invites} />
        </CardContent>
      </Card>
    </div>
  );
}
