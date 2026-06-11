import { loadSeedStore } from "@/lib/data/seed-data";
import { createRepoFromStore } from "@/lib/data/store";
import type { Repo } from "@/lib/data/repo";

/**
 * Read-only demo backend (DATA_BACKEND=seed): serves the seed JSON from
 * memory. Validation throws loudly at module init so shape drift is caught on
 * dev boot, not in a component. The default backend is SQLite (sqlite-repo).
 */
export const seedRepo: Repo = createRepoFromStore(loadSeedStore());
