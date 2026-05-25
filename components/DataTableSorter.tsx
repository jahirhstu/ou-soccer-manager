"use client";

import { useEffect, useRef } from "react";

type SortDirection = "asc" | "desc";

export function DataTableSorter() {
  const markerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = markerRef.current?.closest<HTMLElement>("[data-sortable-table-root]");
    if (!root) return;

    const table = root.querySelector<HTMLTableElement>("table[data-sortable-table]");
    const mobileList = root.querySelector<HTMLElement>("[data-sortable-mobile-list]");
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-sort-column]"));
    let activeColumn: number | null = null;
    let activeDirection: SortDirection = "asc";

    const cleanups = buttons.map((button) => {
      const onClick = () => {
        const columnIndex = Number(button.dataset.sortColumn ?? 0);
        activeDirection = activeColumn === columnIndex && activeDirection === "asc" ? "desc" : "asc";
        activeColumn = columnIndex;
        sortTable(table, columnIndex, activeDirection);
        sortMobileCards(mobileList, columnIndex, activeDirection);
        updateButtons(buttons, columnIndex, activeDirection);
      };
      button.addEventListener("click", onClick);
      return () => button.removeEventListener("click", onClick);
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  return <span aria-hidden="true" className="hidden" ref={markerRef} />;
}

function sortTable(table: HTMLTableElement | null, columnIndex: number, direction: SortDirection) {
  const tbody = table?.tBodies[0];
  if (!tbody) return;

  const rows = Array.from(tbody.rows);
  rows.sort((left, right) => compareCellText(cellText(left, columnIndex), cellText(right, columnIndex), direction));
  rows.forEach((row) => tbody.appendChild(row));
}

function sortMobileCards(list: HTMLElement | null, columnIndex: number, direction: SortDirection) {
  if (!list) return;

  const cards = Array.from(list.querySelectorAll<HTMLElement>("[data-sortable-mobile-card]"));
  cards.sort((left, right) => compareCellText(mobileCellText(left, columnIndex), mobileCellText(right, columnIndex), direction));
  cards.forEach((card) => list.appendChild(card));
}

function updateButtons(buttons: HTMLButtonElement[], activeColumn: number, direction: SortDirection) {
  for (const button of buttons) {
    const isActive = Number(button.dataset.sortColumn ?? -1) === activeColumn;
    button.setAttribute("aria-sort", isActive ? (direction === "asc" ? "ascending" : "descending") : "none");
    button.dataset.sortDirection = isActive ? direction : "none";
    const label = button.dataset.sortLabel ?? "column";
    button.setAttribute("aria-label", isActive ? `Sort ${label} ${direction === "asc" ? "descending" : "ascending"}` : `Sort ${label} ascending`);
    for (const icon of Array.from(button.querySelectorAll("[data-sort-icon]"))) {
      if (icon.getAttribute("data-sort-icon") === (isActive ? direction : "none")) {
        icon.classList.remove("hidden");
      } else {
        icon.classList.add("hidden");
      }
    }
  }
}

function cellText(row: HTMLTableRowElement, columnIndex: number) {
  return row.cells[columnIndex]?.textContent?.trim() ?? "";
}

function mobileCellText(card: HTMLElement, columnIndex: number) {
  return card.querySelector<HTMLElement>(`[data-sort-cell="${columnIndex}"]`)?.textContent?.trim() ?? "";
}

function compareCellText(left: string, right: string, direction: SortDirection) {
  const comparison = compareValues(left, right);
  return direction === "asc" ? comparison : -comparison;
}

function compareValues(left: string, right: string) {
  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  if (leftNumber != null && rightNumber != null) return leftNumber - rightNumber;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function numericValue(value: string) {
  const cleaned = value.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned || /[a-z]/i.test(cleaned)) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}
