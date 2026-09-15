/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A self-contained server bundle, so the container carries only what it runs.
  output: 'standalone',
  // Skew protection. Server action ids are generated per build, so a tab left open across a deploy
  // posts an id the new container has never heard of and Next throws. With a deployment id the
  // client sends which build it came from, and a mismatch becomes a reload instead of an error.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
  // RECALL_API_URL and SIMULATOR_URL are deliberately not listed here: `env` inlines values at
  // build time, which would freeze the deployed server's address into the image. They are read
  // from process.env on the server at request time, and never reach the browser.
};

export default nextConfig;
