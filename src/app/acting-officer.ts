import { resolveViewer } from "@/lib/auth/viewer";
import { getRepo } from "@/lib/data/repo";

/**
 * Who is doing this, for the audit line.
 *
 * Every governance write records a person, and every one of them needs the same
 * three facts: which guild, which membership, and a name a member will
 * recognise months later. It lives here rather than in `src/lib/auth` because
 * it reads the members view — `resolve.ts` is the only file in that layer
 * allowed to touch the database, and this is app-layer glue, not a rule about
 * who may do what.
 *
 * Falls back to "an officer" when the viewer carries no membership — which is
 * unreachable now that enforcement refuses those callers anyway, and stays here
 * because inventing a name would be worse than admitting we do not have one.
 * Entries written before 2026-08-12 say "an officer" for real: nobody was
 * signed in, so there was no name to record.
 */
export async function actingOfficer(): Promise<{
  guildId: string;
  membershipId: string | null;
  actor: string;
}> {
  const [viewer, guild] = await Promise.all([resolveViewer(), getRepo().then((r) => r.getGuild())]);
  if (!viewer.guild) return { guildId: guild.id, membershipId: null, actor: "an officer" };

  const view = await (await getRepo()).getMembersView();
  const me = view.members.find((m) => m.membershipId === viewer.guild!.membershipId);
  return {
    guildId: viewer.guild.guildId,
    membershipId: viewer.guild.membershipId,
    actor: me?.displayName ?? "an officer",
  };
}
