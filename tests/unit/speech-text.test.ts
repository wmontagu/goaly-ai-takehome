import { describe, expect, it } from "vitest";
import { spokenChunks } from "@/app/components/speech-text";

describe("Call mode speech chunks", () => {
  it("speaks each list item on its own, so the voice pauses between them", () => {
    const reply = "You'll need two documents:\n- the pathology report\n- the office note from your doctor\n\n1. Upload them\n2) Then call us";
    expect(spokenChunks(reply)).toEqual([
      "You'll need two documents:",
      "the pathology report",
      "the office note from your doctor",
      "Upload them",
      "Then call us",
    ]);
  });

  it("pauses at spaced dashes but keeps IDs and dates whole", () => {
    expect(spokenChunks("Your claim CL-2048 — filed 2026-01-12 – was denied - here's why.")).toEqual([
      "Your claim CL-2048",
      "filed 2026-01-12",
      "was denied",
      "here's why.",
    ]);
  });

  it("splits sentences without breaking amounts", () => {
    expect(spokenChunks("We paid $1,234.56 on it. **Anything else?** Yes!")).toEqual(["We paid $1,234.56 on it.", "Anything else?", "Yes!"]);
  });
});
