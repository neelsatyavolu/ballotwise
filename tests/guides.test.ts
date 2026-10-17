import { describe, expect, it } from "vitest";
import { signUp } from "../lib/auth/accounts";
import { deleteGuide, getGuide, listGuides, saveGuide, setVoted, type GuideData } from "../lib/guides";
import { testDb } from "./sqlite-db";

const data = {
  query: "q",
  race: { title: "Mayor", election: "General", date: "2026-11-03", jurisdiction: "Town", office: { text: "t", sources: ["https://e.com"] }, votingRule: null, candidates: [], issues: [], sources: [] },
  profiles: {},
  answers: { housing: { stance: 1, weight: 2 } },
  overrides: {},
} as unknown as GuideData;

describe("guides", () => {
  it("saves, lists, updates, marks voted and deletes only the owner's guide", async () => {
    const db = testDb();
    const a = (await signUp(db, "a@example.com", "a long password", 1)).user;
    const b = (await signUp(db, "b@example.com", "a long password", 1)).user;
    expect(await saveGuide(db, a.id, "guide-0001", data, 10)).toBe(true);
    expect(await saveGuide(db, b.id, "guide-0001", data, 11)).toBe(false);
    expect(await getGuide(db, b.id, "guide-0001")).toBeNull();
    expect(await saveGuide(db, a.id, "guide-0001", { ...data, query: "q2" }, 12)).toBe(true);
    const got = await getGuide(db, a.id, "guide-0001");
    expect(got?.data?.query).toBe("q2");
    expect(got?.origin).toBe("search");
    await setVoted(db, b.id, "guide-0001", true);
    expect((await listGuides(db, a.id, "search"))[0]).toMatchObject({ id: "guide-0001", title: "Mayor", status: "ready", voted: false });
    await setVoted(db, a.id, "guide-0001", true);
    expect((await listGuides(db, a.id, "search"))[0].voted).toBe(true);
    expect(await listGuides(db, a.id, "ballot")).toHaveLength(0);
    await deleteGuide(db, b.id, "guide-0001");
    expect(await listGuides(db, a.id, "search")).toHaveLength(1);
    await deleteGuide(db, a.id, "guide-0001");
    expect(await listGuides(db, a.id, "search")).toHaveLength(0);
  });
});
