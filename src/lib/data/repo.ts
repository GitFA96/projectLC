import type {
  AwardWithContext,
  CharacterBundle,
  CharacterSummary,
  DashboardData,
  Guild,
  Item,
  ItemContention,
  RaidSession,
} from "@/lib/types";

/**
 * The data-access boundary. Milestone 1 serves everything from validated seed
 * JSON in memory; Milestone 2 swaps in a SQLite implementation behind the same
 * interface without touching pages or components.
 */
export interface Repo {
  getGuild(): Promise<Guild>;
  listCharacters(): Promise<CharacterSummary[]>;
  getCharacterBundle(slug: string): Promise<CharacterBundle | null>;
  listRaidSessions(): Promise<RaidSession[]>;
  listLootAwards(): Promise<AwardWithContext[]>;
  getItem(id: number): Promise<Item | undefined>;
  getItemContention(itemId: number): Promise<ItemContention | null>;
  getDashboard(): Promise<DashboardData>;
}

export async function getRepo(): Promise<Repo> {
  // M2: switch on process.env.DATA_BACKEND ("seed" | "sqlite").
  const { seedRepo } = await import("@/lib/data/seed-repo");
  return seedRepo;
}
