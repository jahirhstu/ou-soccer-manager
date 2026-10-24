import { describe, expect, it } from "vitest";
import { notificationList, type NotificationRow } from "../notification-list";

const rows: NotificationRow[] = Array.from({ length: 32 }, (_, index) => ({
  id: String(index).padStart(2, "0"), amount: index, message: index % 2 ? "Payment sent" : "Payment accepted",
  read_at: index === 0 ? "2026-10-20T10:00:00Z" : null,
  created_at: `2026-09-${String(index % 28 + 1).padStart(2, "0")}T10:00:00Z`,
  season_id: index % 2 ? "fall" : "summer", season: { name: index % 2 ? "Fall" : "Summer" },
  player: { display_name: index % 2 ? "Jahir" : "Rafi" }
}));

describe("notification listing", () => {
  it("sorts by action date with created fallback before paginating", () => {
    const result = notificationList(rows, {});
    expect(result.rows[0].id).toBe("00");
    expect(result.rows[1].id).toBe("27");
    expect(result.rows).toHaveLength(25);
    expect(result.total).toBe(32);
    expect(result.pages).toBe(2);
  });
  it("combines all four filters case insensitively", () => {
    const result = notificationList(rows, { player: " RAF ", message: "ACCEPTED", season: "summer", status: "read" });
    expect(result.rows.map(row => row.id)).toEqual(["00"]);
    expect(notificationList(rows, { season: "fall", status: "read" }).total).toBe(0);
  });
  it("sorts across pages numerically and preserves distinct rows", () => {
    const first = notificationList(rows, { sort: "amount", direction: "asc", size: "10" });
    const second = notificationList(rows, { sort: "amount", direction: "asc", size: "10", page: "2" });
    expect(first.rows.map(row => row.amount)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(second.rows.map(row => row.amount)).toEqual([10,11,12,13,14,15,16,17,18,19]);
  });
  it("clamps out-of-range pages and handles empty filters and invalid settings", () => {
    expect(notificationList(rows, { page: "999" }).page).toBe(2);
    expect(notificationList(rows, { page: "NaN", size: "-1", sort: "invalid" }).page).toBe(1);
    const empty = notificationList(rows, { message: "missing", page: "10" });
    expect(empty.rows).toEqual([]);
    expect(empty.page).toBe(1);
    expect(empty.pages).toBe(1);
  });
});
