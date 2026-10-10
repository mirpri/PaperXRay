/** Personal credentials are scoped to both the signed-in user and provider. */
function storageKey(userId: string, providerId: string): string {
  return `pxr.providerKey:${userId}:${providerId}`;
}
export function loadProviderKey(userId: string, providerId: string): string {
  return window.localStorage.getItem(storageKey(userId, providerId)) ?? "";
}
export function saveProviderKey(userId: string, providerId: string, key: string): void {
  if (key) window.localStorage.setItem(storageKey(userId, providerId), key);
  else window.localStorage.removeItem(storageKey(userId, providerId));
}
