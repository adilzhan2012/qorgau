/**
 * On GitHub Pages the site is served from /qorgau/, not from the root, so any
 * URL the code builds by hand needs that prefix. Next adds it automatically to
 * `<Link>` and bundled assets, but not to a plain `fetch("/audio/...")`.
 *
 * Empty during local development, so `npm run dev` still serves from /.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
