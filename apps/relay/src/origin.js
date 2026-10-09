/**
 * ALLOWED_ORIGINS: comma separated list of web origins, e.g. "https://my-er.vercel.app".
 * Empty = any origin. Pages served from localhost / 127.0.0.1 are always allowed (local development).
 *
 * This keeps casual third-party websites from using your relay (and your free quota); it is not authentication:
 * a script can send any Origin header, and anyone who knows a room link can still join that room.
 */
export function originAllowed(origin, allowedOrigins) {
  const list = String(allowedOrigins ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
  if (!list.length) return true
  if (!origin) return false
  if (list.includes(origin)) return true
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}
