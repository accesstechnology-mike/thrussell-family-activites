import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.squarespace-cdn.com" },
      { protocol: "https", hostname: "static1.squarespace.com" },
      { protocol: "https", hostname: "nt.global.ssl.fastly.net" },
      { protocol: "https", hostname: "www.nationaltrust.org.uk" },
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "commons.wikimedia.org" },
      { protocol: "https", hostname: "i0.wp.com" },
      { protocol: "https", hostname: "i1.wp.com" },
      { protocol: "https", hostname: "i2.wp.com" },
      { protocol: "https", hostname: "yorkshiretots.com" },
      { protocol: "https", hostname: "www.yorkshiretots.com" },
      { protocol: "https", hostname: "little-vikings.co.uk" },
      { protocol: "https", hostname: "www.little-vikings.co.uk" },
      { protocol: "https", hostname: "www.english-heritage.org.uk" },
      { protocol: "https", hostname: "english-heritage.org.uk" },
    ],
  },
};

export default nextConfig;
