import { BlockList, isIP } from "node:net";

/**
 * Addresses the URL importer must never connect to (docs/02-decisions.md
 * #7): the server fetching a user-supplied URL is otherwise a probe into
 * the network it's deployed on — and self-hosted campus deployments sit
 * inside exactly the kind of network worth probing.
 */
const blocked = new BlockList();

for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}

for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 — embeds an IPv4 address
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001::", 32], // Teredo — embeds an IPv4 address
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — embeds an IPv4 address
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) IPv6 addresses are checked as the IPv4 address they carry. */
function embeddedIpv4(address: string): string | null {
  const match = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (match) return match[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True for anything that isn't a public unicast address — including strings that aren't IP addresses at all (fail closed). */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return blocked.check(address, "ipv4");
  if (version === 6) {
    const v4 = embeddedIpv4(address);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true;
}

/** `host` is allowed if it equals an allowlisted domain or is a subdomain of one. */
export function isAllowedHost(host: string, allowedHosts: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}
