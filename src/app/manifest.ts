import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "روان — پیام‌رسان",
    short_name: "روان",
    description: "پیام‌رسان فارسی روان",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0f12",
    theme_color: "#0b0f12",
    lang: "fa",
    dir: "rtl",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
