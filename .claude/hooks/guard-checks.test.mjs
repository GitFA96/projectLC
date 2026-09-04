import { describe, expect, it } from "vitest";
import {
  LIVE_DB,
  SANCTIONED_DIST,
  checkBuild,
  checkDevServer,
  checkDistDir,
  checkLiveDb,
  distDirOf,
  needsPortCheck,
  splitSegments,
  stripHeredocs,
} from "./guard-checks.mjs";

/**
 * The session guards decide whether a command runs at all, so both halves of
 * each one are worth pinning: what it refuses, and — just as much — what it
 * lets through.
 *
 * A guard that is merely strict gets switched off. Two of the allow cases below
 * are commands these hooks actually refused before they were tested: writing a
 * document that quoted the dist-dir variable, and writing a memory note that
 * named it. Both were prose going to disk through a heredoc.
 */

const BUSY = true;
const FREE = false;

describe("stripHeredocs", () => {
  it("drops a heredoc body, which is content rather than a command", () => {
    const command = `cat > notes.md <<'EOF'\nNever touch ${LIVE_DB} by hand.\nEOF\necho done`;
    const stripped = stripHeredocs(command);
    expect(stripped).not.toContain(LIVE_DB);
    expect(stripped).toContain("echo done");
  });

  it("keeps ordinary quotes, where the dangerous half of a command hides", () => {
    const command = `sqlite3 "${LIVE_DB}" "DELETE FROM characters"`;
    expect(stripHeredocs(command)).toContain(LIVE_DB);
  });

  it("drops everything after an unterminated heredoc rather than guessing", () => {
    expect(stripHeredocs(`cat <<EOF\n${LIVE_DB}`)).not.toContain(LIVE_DB);
  });
});

describe("splitSegments", () => {
  it("splits on every separator the shell would run separately", () => {
    expect(splitSegments("a && b || c ; d | e")).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("checkDistDir", () => {
  it("allows the sanctioned dist dir", () => {
    expect(checkDistDir(`NEXT_DIST_DIR=${SANCTIONED_DIST} npm run build`)).toBeNull();
  });

  it("refuses any other, which .gitignore does not cover", () => {
    expect(checkDistDir("NEXT_DIST_DIR=.next-preview npm run build")).toContain("not a dist dir");
  });

  it("allows a command that has no dist dir in it at all", () => {
    expect(checkDistDir("npm test")).toBeNull();
  });

  /*
   * The regression this file exists for. The old capture ran to the next
   * whitespace, so an inline code span closing on a backtick captured
   * `.next-build\`` — one character different from the sanctioned name, and
   * refused. It denied a documentation write twice.
   */
  it("does not read a value out of prose in a heredoc", () => {
    const command = `cat > doc.md <<'EOF'\nBuild with \`NEXT_DIST_DIR=${SANCTIONED_DIST}\` while the server runs.\nEOF`;
    expect(checkDistDir(command)).toBeNull();
  });

  it("stops the captured value at a backtick even outside a heredoc", () => {
    expect(distDirOf(`echo "\`NEXT_DIST_DIR=${SANCTIONED_DIST}\`"`)).toBe(SANCTIONED_DIST);
  });
});

describe("checkDevServer", () => {
  it("refuses a second dev server while one is answering", () => {
    for (const command of ["npm run dev", "npx next dev", "yarn dev", "cd app && npm run dev"]) {
      expect(checkDevServer(command, BUSY), command).toContain("already answering");
    }
  });

  it("allows one when nothing is listening", () => {
    expect(checkDevServer("npm run dev", FREE)).toBeNull();
  });

  it("ignores commands that only look like one", () => {
    expect(checkDevServer("npm run develop-docs", BUSY)).toBeNull();
    expect(checkDevServer("git commit -m 'dev notes'", BUSY)).toBeNull();
  });
});

describe("checkBuild", () => {
  it("refuses a bare next build, which skips both shipped-bug guards", () => {
    for (const command of ["next build", "npx next build", "cd . && next build"]) {
      expect(checkBuild(command, FREE), command).toContain("skips the two guards");
    }
  });

  it("allows npm run build, which is the guarded form", () => {
    expect(checkBuild("npm run build", FREE)).toBeNull();
  });

  it("refuses a build that would share .next with a running dev server", () => {
    expect(checkBuild("npm run build", BUSY)).toContain("take that server down");
  });

  it("allows that build when it is sent to the sanctioned dist dir", () => {
    expect(checkBuild(`NEXT_DIST_DIR=${SANCTIONED_DIST} npm run build`, BUSY)).toBeNull();
  });

  it("leaves unrelated scripts alone", () => {
    expect(checkBuild("npm run build:profile", BUSY)).toBeNull();
    expect(checkBuild("npm test", BUSY)).toBeNull();
  });
});

describe("needsPortCheck", () => {
  it("asks for a probe only when the verdict depends on one", () => {
    expect(needsPortCheck("npm run dev")).toBe(true);
    expect(needsPortCheck("npm run build")).toBe(true);
    // The common case: nothing about `git status` depends on what is listening,
    // and this hook runs in front of every Bash call in the session.
    expect(needsPortCheck("git status")).toBe(false);
    expect(needsPortCheck("npm test")).toBe(false);
  });
});

describe("checkLiveDb", () => {
  it("refuses reads as well as writes, because the .db alone is stale", () => {
    for (const command of [
      `sqlite3 ${LIVE_DB} "SELECT count(*) FROM characters"`,
      `rm ${LIVE_DB}`,
      `PROJECTLC_DB=${LIVE_DB} npm test`,
      `node -e "require('node:sqlite')" ${LIVE_DB}`,
      // Windows spelling, and the sidecar files that carry the newest rows.
      `type data\\projectlc.db`,
      `rm ${LIVE_DB}-wal`,
    ]) {
      expect(checkLiveDb(command), command).toContain("live guild data");
    }
  });

  it("allows copying it out to the scratchpad, which is the documented flow", () => {
    expect(checkLiveDb(`cp ${LIVE_DB} /tmp/scratch/copy.db`)).toBeNull();
    expect(checkLiveDb(`cp ${LIVE_DB} ${LIVE_DB}-wal ${LIVE_DB}-shm /tmp/scratch/`)).toBeNull();
    expect(checkLiveDb(`Copy-Item -Path ${LIVE_DB} -Destination C:/tmp/copy.db`)).toBeNull();
  });

  /*
   * A copy is only safe in one direction. Restoring *over* the live file is
   * spelled almost identically and destroys exactly what the guard protects.
   */
  it("refuses a copy that lands on the live file or back inside data/", () => {
    expect(checkLiveDb(`cp /tmp/old.db ${LIVE_DB}`)).toContain("live guild data");
    expect(checkLiveDb(`cp ${LIVE_DB} data/backup.db`)).toContain("live guild data");
  });

  /*
   * The defeat a first-word check would miss: open with a sanctioned copy, then
   * destroy the original in the same line.
   */
  it("judges each segment, so a safe prefix cannot smuggle a write", () => {
    expect(checkLiveDb(`cp ${LIVE_DB} /tmp/x.db && rm ${LIVE_DB}`)).toContain("live guild data");
  });

  it("allows commands that touch the directory but not the database", () => {
    expect(checkLiveDb("ls -la data/")).toBeNull();
    expect(checkLiveDb("npm run dev")).toBeNull();
    expect(checkLiveDb('PROJECTLC_DB="$SCRATCH/copy.db" npm test')).toBeNull();
  });

  it("does not refuse a document that merely names the file", () => {
    const command = `cat > docs/note.md <<'EOF'\nNever write to ${LIVE_DB}.\nEOF`;
    expect(checkLiveDb(command)).toBeNull();
  });

  it("names the segment it refused, so the fix is obvious", () => {
    expect(checkLiveDb(`echo hi && rm ${LIVE_DB}`)).toContain(`rm ${LIVE_DB}`);
  });
});
