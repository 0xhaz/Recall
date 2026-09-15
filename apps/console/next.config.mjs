/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A self-contained server bundle, so the container carries only what it runs.
  output: 'standalone',
  // RECALL_API_URL and SIMULATOR_URL are deliberately not listed here: `env` inlines values at
  // build time, which would freeze the deployed server's address into the image. They are read
  // from process.env on the server at request time, and never reach the browser.
};

export default nextConfig;
