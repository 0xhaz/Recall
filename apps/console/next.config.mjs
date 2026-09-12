/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The console talks to the Recall server from the server side only, so the token never reaches the browser.
  env: { RECALL_API_URL: process.env.RECALL_API_URL ?? 'http://127.0.0.1:3100' },
};

export default nextConfig;
