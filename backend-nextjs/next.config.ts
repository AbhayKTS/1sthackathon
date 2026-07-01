import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This is a backend-only project (Option A architecture).
  // The Vite frontend is served separately on Firebase Hosting.
  
  // Prevent firebase-admin from being bundled into client-side code.
  serverExternalPackages: ["firebase-admin"],

  // Silence the turbopack root warning caused by multiple lockfiles in the monorepo
  turbopack: {
    root: __dirname,
  },

  // Allow the API to be called from the Vite frontend in dev
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
