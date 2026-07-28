import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.squarespace-cdn.com",
      },
      {
        protocol: "https",
        hostname: "static1.squarespace.com",
      },
      {
        protocol: "https",
        hostname: "nt.global.ssl.fastly.net",
      },
      {
        protocol: "https",
        hostname: "www.nationaltrust.org.uk",
      },
    ],
  },
};

export default nextConfig;
