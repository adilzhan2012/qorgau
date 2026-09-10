/**
 * The site is published as static files on GitHub Pages, so it can be opened
 * from a URL on any laptop with nothing installed. That rules out server
 * routes — everything, including the classifier, runs in the browser.
 *
 * NEXT_PUBLIC_BASE_PATH is set only by the deploy workflow. Left unset,
 * `npm run dev` keeps serving from / exactly as before.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  // Static export has no image optimiser behind it.
  images: { unoptimized: true },
  // Pages serves /selftest/ as a directory; without this the link 404s.
  trailingSlash: true,
};

export default nextConfig;
