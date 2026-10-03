import { ImageResponse } from "next/og";
import { BRAND_COLOR, LOGO_BUBBLE_PATH, LOGO_W_POINTS } from "@/lib/brand";

// Replaces the default Next.js favicon with the brand mark — the same
// bubble + "W" glyph as <LogoMark> in `src/components/brand/logo.tsx`.
// Next.js renders this at build time and auto-injects <link rel="icon">
// into <head>.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_COLOR,
          borderRadius: 7,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24">
          <path d={LOGO_BUBBLE_PATH} fill="#ffffff" />
          <polyline
            points={LOGO_W_POINTS}
            fill="none"
            stroke={BRAND_COLOR}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
