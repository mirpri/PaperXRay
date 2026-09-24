/** design/03-icon.html's 24px mark, reused as the header logo. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Paper X-Ray">
      <rect width="100" height="100" rx="22" fill="#1A1A1A" />
      <rect x="20" y="17" width="45" height="66" rx="2" fill="#FFFFFF" fillOpacity="0.16" stroke="#FFFFFF" strokeWidth="4" />
      <rect x="28" y="45" width="29" height="10" fill="#D4A017" />
      <rect x="70" y="24" width="10" height="20" fill="#D4A017" />
      <rect x="70" y="52" width="10" height="24" fill="#7FA3CC" />
    </svg>
  );
}
