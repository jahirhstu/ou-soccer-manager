import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/transfers", () => ({ carryForwardPlayerBalance: vi.fn() }));
import { CarryForwardForm } from "@/components/CarryForwardForm";
import { balanceTransferLabel } from "@/lib/transfers";

const seasons = [
  { id: "summer", name: "Summer", program_id: "football" },
  { id: "fall", name: "Fall", program_id: "football" },
  { id: "other", name: "Other program", program_id: "other" }
];

describe("carry-forward balance form", () => {
  it.each([
    ["0", "24", "debt", "$14.00 owing"],
    ["24", "0", "credit", "$34.00 credit"]
  ])("detects source balance %s/%s and previews its destination offset", (credit, owes, kind, after) => {
    const html = renderToStaticMarkup(<CarryForwardForm
      options={[{ playerId: "player", playerName: "Inactive player", seasonId: "summer", seasonName: "Summer", programId: "football", credit, owes }]}
      seasons={seasons} balances={[{ playerId: "player", seasonId: "fall", credit: "10", owes: "0" }]}
      submissionId="submission" today="2020-01-01"
    />);
    expect(html).toContain("Carry forward balance");
    expect(html).toContain(`name="transfer_kind" value="${kind}"`);
    expect(html).toContain('max="24"');
    expect(html).toContain("Source balance after: $0.00 (Settled)");
    expect(html).toContain(`Destination balance after: ${after}`);
    expect(html).not.toContain("Other program");
  });

  it("distinguishes every history direction", () => {
    expect(balanceTransferLabel("credit_transferred_in")).toBe("Credit in");
    expect(balanceTransferLabel("credit_transferred_out")).toBe("Credit out");
    expect(balanceTransferLabel("debt_transferred_in")).toBe("Owing in");
    expect(balanceTransferLabel("debt_transferred_out")).toBe("Owing out");
  });
});
