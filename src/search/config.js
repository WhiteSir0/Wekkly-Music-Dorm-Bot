export function isTailscaleIpv4(value) {
  const parts = value.split('.').map(Number);
  return parts.length === 4
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && parts[0] === 100
    && parts[1] >= 64
    && parts[1] <= 127;
}
