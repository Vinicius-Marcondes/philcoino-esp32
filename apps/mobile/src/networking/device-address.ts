export function normalizeDeviceAddress(address: string): string {
  const candidate = address.trim();
  if (candidate.length === 0) {
    throw new TypeError("A device address is required.");
  }

  const withScheme = candidate.includes("://")
    ? candidate
    : `http://${candidate}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new TypeError("The device address is invalid.");
  }

  if (
    url.protocol !== "http:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError("The device address must be a local HTTP origin.");
  }

  return url.origin;
}
