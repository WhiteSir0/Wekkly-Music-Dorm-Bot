export function parseGuildIds(value) {
  return [...new Set((value ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
}
