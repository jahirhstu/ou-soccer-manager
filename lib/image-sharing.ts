export function imageFileName(label: string, kind: string, date?: string | null) {
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug(label) || "session"}${date ? `-${date.replace(/[^0-9-]/g, "")}` : ""}-${slug(kind) || "report"}.png`;
}

export function canShareImages(files: File[]) {
  if (!files.length) return false;
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files });
  } catch {
    return false;
  }
}

export async function shareImages(files: File[], title: string): Promise<"shared" | "cancelled"> {
  try {
    await navigator.share({ files, title });
    return "shared";
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    throw error;
  }
}

// Paginate measured rows, not screenshots: headers repeat and no row is cropped.
export function paginateShareImage(source: HTMLElement, maxHeight?: number) {
  if (!maxHeight || source.offsetHeight <= maxHeight) return { pages: [source], cleanup: () => {} };
  const pages: HTMLElement[] = [];
  const header = source.querySelector(":scope > [data-share-header]");
  const contentLimit = maxHeight - 40;
  const createPage = () => {
    const page = source.cloneNode(false) as HTMLElement;
    if (header) page.append(header.cloneNode(true));
    source.parentElement!.append(page);
    pages.push(page);
    return page;
  };
  const cleanup = () => pages.forEach((page) => page.remove());
  try {
    let page = createPage();
    for (const section of Array.from(source.querySelectorAll<HTMLElement>(":scope > [data-share-section]"))) {
      const sectionHeader = section.querySelector(":scope > [data-share-section-header]");
      const sourceRows = section.querySelector<HTMLElement>(":scope > [data-share-rows]");
      if (!sourceRows) continue;
      const createSection = () => {
        const copy = section.cloneNode(false) as HTMLElement;
        if (sectionHeader) copy.append(sectionHeader.cloneNode(true));
        const rows = sourceRows.cloneNode(false) as HTMLElement;
        copy.append(rows);
        page.append(copy);
        return { copy, rows };
      };
      let current = createSection();
      for (const row of Array.from(sourceRows.children)) {
        const copy = row.cloneNode(true) as HTMLElement;
        current.rows.append(copy);
        if (page.offsetHeight > contentLimit) {
          copy.remove();
          if (!current.rows.childElementCount) current.copy.remove();
          if (page.children.length > (header ? 1 : 0)) page = createPage();
          current = createSection();
          current.rows.append(copy);
          if (page.offsetHeight > contentLimit) throw new Error("A report row is too large for a phone image.");
        }
      }
    }
    if (pages.length > 1) pages.forEach((page, index) => {
      const footer = document.createElement("div");
      footer.textContent = `${index + 1} / ${pages.length}`;
      Object.assign(footer.style, { textAlign: "right", fontSize: "22px", lineHeight: "28px", paddingTop: "8px", color: "#64748b" });
      page.append(footer);
    });
    return { pages, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
