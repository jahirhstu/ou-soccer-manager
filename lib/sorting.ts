export function compareText(left: unknown, right: unknown) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base" });
}

export function compareNumberDesc(left: unknown, right: unknown) {
  return numberValue(right) - numberValue(left);
}

export function compareNumberAsc(left: unknown, right: unknown) {
  return numberValue(left) - numberValue(right);
}

export function numberValue(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
