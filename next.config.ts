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
        source: "/krasnodar/kategorii/:path*",
        destination: "/katalog/:path*",
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
        source: "/krasnodar/obyavlenie/:path*",
        destination: "/obyavlenie/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/zhivotnye/:path*",
        destination: "/katalog/zhivotnye/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/sad-i-rasteniya/:path*",
        destination: "/katalog/sad-i-rasteniya/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/tovary-dlya-detey/:path*",
        destination: "/katalog/tovary-dlya-detey/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/ritualnye-uslugi/:path*",
        destination: "/katalog/ritualnye-uslugi/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/nedvizhimost/:path*",
        destination: "/katalog/nedvizhimost/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/rabota/:path*",
        destination: "/katalog/rabota/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/odezhda-obuv-aksessuary/:path*",
        destination: "/katalog/odezhda-obuv-aksessuary/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/otdyh/:path*",
        destination: "/katalog/otdyh/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/transport/:path*",
        destination: "/katalog/transport/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/biznes/:path*",
        destination: "/katalog/biznes/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/uslugi-dlya-doma/:path*",
        destination: "/katalog/uslugi-dlya-doma/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/elektronika/:path*",
        destination: "/katalog/elektronika/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/dlya-doma-i-dachi/:path*",
        destination: "/katalog/dlya-doma-i-dachi/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/instrumenty/:path*",
        destination: "/katalog/instrumenty/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/krasota-i-uhod/:path*",
        destination: "/katalog/krasota-i-uhod/:path*",
        permanent: false,
      },
      {
        source: "/krasnodar/raznoe/:path*",
        destination: "/katalog/raznoe/:path*",
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
