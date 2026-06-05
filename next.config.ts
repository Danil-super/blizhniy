import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async redirects() {
    return [
      {
        source: "/krasnodar",
        destination: "/blizhniy",
        permanent: false,
      },
      {
        source: "/krasnodar/:path*",
        destination: "/blizhniy/:path*",
        permanent: false,
      },
      {
        source: "/obyavlenie/:path*",
        destination: "/blizhniy/obyavlenie/:path*",
        permanent: false,
      },
      {
        source: "/vakansiya/:path*",
        destination: "/blizhniy/vakansiya/:path*",
        permanent: false,
      },
      {
        source: "/specialist/:path*",
        destination: "/blizhniy/specialist/:path*",
        permanent: false,
      },
      {
        source: "/oplata/:path*",
        destination: "/blizhniy/oplata/:path*",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/blizhniy/obyavlenie/:slug/redaktirovat",
        destination: "/krasnodar/obyavlenie/:slug/redaktirovat",
      },
      {
        source: "/blizhniy/obyavlenie/:path*",
        destination: "/obyavlenie/:path*",
      },
      {
        source: "/blizhniy/vakansiya/:path*",
        destination: "/vakansiya/:path*",
      },
      {
        source: "/blizhniy/specialist/:path*",
        destination: "/specialist/:path*",
      },
      {
        source: "/blizhniy/oplata/:path*",
        destination: "/oplata/:path*",
      },
      {
        source: "/blizhniy/poisk",
        destination: "/poisk",
      },
      {
        source: "/blizhniy/yarmarka-masterov",
        destination: "/yarmarka-masterov",
      },
      {
        source: "/blizhniy/yarmarka-masterov/zayavka",
        destination: "/yarmarka-masterov/zayavka",
      },
      {
        source: "/blizhniy",
        destination: "/krasnodar",
      },
      {
        source: "/blizhniy/:path*",
        destination: "/krasnodar/:path*",
      },
    ];
  },
};

export default nextConfig;
