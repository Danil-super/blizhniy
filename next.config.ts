import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  webpack(config, { isServer }) {
    if (isServer && config.output) {
      config.output.chunkFilename = "chunks/[name].js";
    }

    return config;
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
        permanent: true,
      },
      {
        source: "/krasnodar/kategorii",
        destination: "/katalog",
        permanent: true,
      },
      {
        source: "/krasnodar/kategorii/:path*",
        destination: "/katalog/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/sozdat/obyavlenie",
        destination: "/razmestit/obyavlenie",
        permanent: true,
      },
      {
        source: "/krasnodar/sozdat",
        destination: "/razmestit",
        permanent: true,
      },
      {
        source: "/obyavleniya/menyayu",
        destination: "/obyavleniya/otdam-darom",
        permanent: true,
      },
      {
        source: "/obyavleniya/obmen-i-darom",
        destination: "/obyavleniya/otdam-darom",
        permanent: true,
      },
      {
        source: "/krasnodar/prodam",
        destination: "/obyavleniya/prodam",
        permanent: true,
      },
      {
        source: "/krasnodar/kuplyu",
        destination: "/obyavleniya/kuplyu",
        permanent: true,
      },
      {
        source: "/krasnodar/menyayu",
        destination: "/obyavleniya/otdam-darom",
        permanent: true,
      },
      {
        source: "/krasnodar/otdam-darom",
        destination: "/obyavleniya/otdam-darom",
        permanent: true,
      },
      {
        source: "/krasnodar/obmen-i-darom",
        destination: "/obyavleniya/otdam-darom",
        permanent: true,
      },
      {
        source: "/krasnodar/obyavlenie/:path*",
        destination: "/obyavlenie/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota",
        destination: "/rabota",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota/vakansii",
        destination: "/rabota/vakansii",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota/vakansii/sozdat",
        destination: "/rabota/vakansii/sozdat",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota/vakansii/:slug/redaktirovat",
        destination: "/rabota/vakansii/:slug/edit",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota/specialisty",
        destination: "/rabota/specialisty",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota/specialisty/anketa",
        destination: "/rabota/specialisty/anketa",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota/specialisty/:path*",
        destination: "/rabota/specialisty/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota/zakazy/:slug/redaktirovat",
        destination: "/rabota/zakazy/:slug/edit",
        permanent: true,
      },
      {
        source: "/krasnodar/rabota/zakazy/:path*",
        destination: "/rabota/zakazy/:path*",
        permanent: true,
      },
      {
        source: "/rabota/orders/:path*",
        destination: "/rabota/zakazy/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/zhivotnye/:path*",
        destination: "/katalog/zhivotnye/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/sad-i-rasteniya/:path*",
        destination: "/katalog/sad-i-rasteniya/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/tovary-dlya-detey/:path*",
        destination: "/katalog/tovary-dlya-detey/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/ritualnye-uslugi/:path*",
        destination: "/katalog/ritualnye-uslugi/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/nedvizhimost/:path*",
        destination: "/katalog/nedvizhimost/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/odezhda-obuv-aksessuary/:path*",
        destination: "/katalog/odezhda-obuv-aksessuary/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/otdyh/:path*",
        destination: "/katalog/otdyh/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/transport/:path*",
        destination: "/katalog/transport/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/biznes/:path*",
        destination: "/katalog/biznes/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/uslugi-dlya-doma/:path*",
        destination: "/katalog/uslugi-dlya-doma/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/elektronika/:path*",
        destination: "/katalog/elektronika/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/dlya-doma-i-dachi/:path*",
        destination: "/katalog/dlya-doma-i-dachi/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/instrumenty/:path*",
        destination: "/katalog/instrumenty/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/krasota-i-uhod/:path*",
        destination: "/katalog/krasota-i-uhod/:path*",
        permanent: true,
      },
      {
        source: "/krasnodar/raznoe/:path*",
        destination: "/katalog/raznoe/:path*",
        permanent: true,
      },
      {
        source: "/blizhniy/obyavlenie/:path*",
        destination: "/obyavlenie/:path*",
        permanent: true,
      },
      {
        source: "/blizhniy/vakansiya/:path*",
        destination: "/vakansiya/:path*",
        permanent: true,
      },
      {
        source: "/blizhniy/specialist/:path*",
        destination: "/specialist/:path*",
        permanent: true,
      },
      {
        source: "/blizhniy/oplata/:path*",
        destination: "/oplata/:path*",
        permanent: true,
      },
      {
        source: "/blizhniy/prodavets/:path*",
        destination: "/prodavets/:path*",
        permanent: true,
      },
      {
        source: "/blizhniy/poisk",
        destination: "/poisk",
        permanent: true,
      },
      {
        source: "/blizhniy/yarmarka-masterov",
        destination: "/yarmarka-masterov",
        permanent: true,
      },
      {
        source: "/blizhniy/yarmarka-masterov/zayavka",
        destination: "/yarmarka-masterov/zayavka",
        permanent: true,
      },
      {
        source: "/blizhniy",
        destination: "/",
        permanent: true,
      },
      {
        source: "/blizhniy/:path*",
        destination: "/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
