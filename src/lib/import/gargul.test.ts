import { describe, expect, it } from "vitest";
import { parseGargulExport } from "@/lib/import/gargul";

describe("parseGargulExport", () => {
  it("parses the recommended @DATE;@TIME;@ID;@ITEM;@WINNER;@OS format", () => {
    const { lines, warnings } = parseGargulExport(
      "2026-06-04;22:55;30243;Helm of the Vanquished Defender;Thrainn;0\n" +
        "2026-06-04;22:57;30247;Leggings of the Vanquished Hero;Morgrave;1",
    );
    expect(warnings).toEqual([]);
    expect(lines).toEqual([
      {
        awardedAt: "2026-06-04T22:55:00",
        itemId: 30243,
        itemName: "Helm of the Vanquished Defender",
        rawWinnerName: "Thrainn",
        offspec: false,
        quality: undefined,
      },
      {
        awardedAt: "2026-06-04T22:57:00",
        itemId: 30247,
        itemName: "Leggings of the Vanquished Hero",
        rawWinnerName: "Morgrave",
        offspec: true,
        quality: undefined,
      },
    ]);
  });

  it("understands in-game item links (id, name, quality from the color)", () => {
    const link = "|cffa335ee|Hitem:28830:0:0:0:0:0:0:0:70|h[Dragonspine Trophy]|h|r";
    const { lines } = parseGargulExport(`2026-06-04;22:55;${link};Sylvaria;0`);
    expect(lines).toHaveLength(1);
    expect(lines[0].itemId).toBe(28830);
    expect(lines[0].itemName).toBe("Dragonspine Trophy");
    expect(lines[0].quality).toBe("epic");
  });

  it("handles tab and comma delimiters and OS words", () => {
    const tabbed = parseGargulExport("2026-06-04\t21:48\t30627\tTsunami Talisman\tShivven\tOS");
    expect(tabbed.lines[0].offspec).toBe(true);
    const comma = parseGargulExport("2026-06-04,21:48,30627,Tsunami Talisman,Shivven,MS");
    expect(comma.lines[0].offspec).toBe(false);
  });

  it("normalizes EU dates and strips realms from winners", () => {
    const { lines } = parseGargulExport("04/06/2026;30627;Tsunami Talisman;Shivven-Firemaw;0");
    expect(lines[0].awardedAt).toBe("2026-06-04T00:00:00");
    expect(lines[0].rawWinnerName).toBe("Shivven");
  });

  it("uses the fallback date when lines carry only a time", () => {
    const { lines } = parseGargulExport("22:55;30243;Helm of the Vanquished Defender;Thrainn;0", {
      fallbackDate: "2026-06-11",
    });
    expect(lines[0].awardedAt).toBe("2026-06-11T22:55:00");
  });

  it("skips undated lines without a fallback, with a warning", () => {
    const { lines, warnings } = parseGargulExport("30243;Helm;Thrainn;0");
    expect(lines).toHaveLength(0);
    expect(warnings.some((w) => w.includes("no date"))).toBe(true);
  });

  it("drops in-paste duplicates and reports them", () => {
    const line = "2026-06-04;22:55;30243;Helm of the Vanquished Defender;Thrainn;0";
    const { lines, warnings } = parseGargulExport(`${line}\n${line}`);
    expect(lines).toHaveLength(1);
    expect(warnings.some((w) => w.includes("duplicate"))).toBe(true);
  });

  it("skips garbage lines with a warning and keeps the rest", () => {
    const { lines, warnings } = parseGargulExport(
      "complete nonsense\n2026-06-04;22:55;30243;Helm of the Vanquished Defender;Thrainn;0",
    );
    expect(lines).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  });

  it("reads Gargul's standard CSV export by header — winner is the character, the id column is ignored", () => {
    const { lines, warnings } = parseGargulExport(
      "dateTime,character,itemID,offspec,id\n" +
        "2026-06-17,Sylvaria,28830,0,10036338451993911234\n" +
        "2026-06-17,Morgrave,28773,1,11032160261916129712",
    );
    // The header is consumed silently — no "Line 1 skipped" warning.
    expect(warnings).toEqual([]);
    expect(lines).toEqual([
      {
        awardedAt: "2026-06-17T00:00:00",
        itemId: 28830,
        itemName: undefined,
        rawWinnerName: "Sylvaria",
        offspec: false,
        quality: undefined,
      },
      {
        awardedAt: "2026-06-17T00:00:00",
        itemId: 28773,
        itemName: undefined,
        rawWinnerName: "Morgrave",
        offspec: true,
        quality: undefined,
      },
    ]);
  });

  it("reads a header dateTime that carries the time too", () => {
    const { lines } = parseGargulExport(
      "dateTime,character,itemID,offspec,id\n2026-06-17 22:55:01,Thrainn,30243,0,99",
    );
    expect(lines[0].awardedAt).toBe("2026-06-17T22:55:00");
  });

  it("honors header order and an itemName column, link or realm-suffixed name", () => {
    const link = "|cffa335ee|Hitem:28830:0:0:0:0:0:0:0:70|h[Dragonspine Trophy]|h|r";
    const { lines, warnings } = parseGargulExport(
      "id,winner,date,item,itemName,os\n" +
        `987654321098765,Shivven-Firemaw,2026-06-17,${link},ignored name,os`,
    );
    expect(warnings).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      itemId: 28830,
      itemName: "Dragonspine Trophy",
      rawWinnerName: "Shivven",
      offspec: true,
      quality: "epic",
    });
  });

  it("warns when only the header row was pasted", () => {
    const { lines, warnings } = parseGargulExport("dateTime,character,itemID,offspec,id");
    expect(lines).toHaveLength(0);
    expect(warnings.some((w) => w.includes("header"))).toBe(true);
  });

  it("drops a trailing award-id number in a header-less paste instead of reading it as the winner", () => {
    const { lines } = parseGargulExport(
      "2026-06-04;22:55;30243;Helm of the Vanquished Defender;Thrainn;0;10036338451993911234",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].rawWinnerName).toBe("Thrainn");
    expect(lines[0].itemId).toBe(30243);
  });
});
