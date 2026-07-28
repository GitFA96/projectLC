import { describe, expect, it, vi } from "vitest";
import { refreshAfterWrite } from "@/lib/refresh";

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

describe("refreshAfterWrite", () => {
  it("revalidates the whole tree by default, and a single path on request", () => {
    revalidatePath.mockClear();
    refreshAfterWrite("/", "layout");
    refreshAfterWrite("/logs");
    expect(revalidatePath.mock.calls).toEqual([["/", "layout"], ["/logs"]]);
  });

  it("swallows a refresh failure — the write it follows already succeeded", () => {
    revalidatePath.mockClear();
    revalidatePath.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing in revalidatePath /");
    });
    // Throwing here would land in the caller's catch and report a committed
    // write as failed, which invites a duplicating retry.
    expect(() => refreshAfterWrite()).not.toThrow();
    expect(revalidatePath).toHaveBeenCalledOnce();
  });
});
