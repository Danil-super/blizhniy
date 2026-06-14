import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/krasnodar",
        destination: "/",
        permanent: false,
      },
      {
        source: "/krasnodar/kategorii",
        destination: "/katalog",
        permanent: false,
      },
      {
        source: "/krasnodar/sozdat/obyavlenie",
        destination: "/razmestit/obyavlenie",
        permanent: false,
      },
      {
        source: "/krasnodar/prodam",
        destination: "/obyavleniya/prodam",
        permanent: false,
      },
      {
        source: "/krasnodar/kuplyu",
        destination: "/obyavleniya/kuplyu",
        permanent: false,
      },
      {
        source: "/krasnodar/menyayu",
        destination: "/obyavleniya/menyayu",
        permanent: false,
      },
      {
        source: "/krasnodar/otdam-darom",
        destination: "/obyavleniya/otdam-darom",
        permanent: false,
      },
      {
        source: "/krasnodar/obmen-i-darom",
        destination: "/obyavleniya/obmen-i-darom",
        permanent: false,
      },
      {
        source: "/blizhniy/obyavlenie/:slug/redaktirovat",
        destination: "/krasnodar/obyavlenie/:slug/redaktirovat",
        permanent: false,
      },
      {
        source: "/blizhniy/obyavlenie/:path*",
        destination: "/obyavlenie/:path*",
        permanent: false,
      },
      {
        source: "/blizhniy/vakansiya/:path*",
        destination: "/vakansiya/:path*",
        permanent: false,
      },
      {
        source: "/blizhniy/specialist/:path*",
        destination: "/specialist/:path*",
        permanent: false,
      },
      {
        source: "/blizhniy/oplata/:path*",
        destination: "/oplata/:path*",
        permanent: false,
      },
      {
        source: "/blizhniy/prodavets/:path*",
        destination: "/prodavets/:path*",
        permanent: false,
      },
      {
        source: "/blizhniy/poisk",
        destination: "/poisk",
        permanent: false,
      },
      {
        source: "/blizhniy/yarmarka-masterov",
        destination: "/yarmarka-masterov",
        permanent: false,
      },
      {
        source: "/blizhniy/yarmarka-masterov/zayavka",
        destination: "/yarmarka-masterov/zayavka",
        permanent: false,
      },
      {
        source: "/blizhniy",
        destination: "/",
        permanent: false,
      },
      {
        source: "/blizhniy/:path*",
        destination: "/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
