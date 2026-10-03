import Link from "next/link";
import { cn } from "@/lib/utils";
import { BRAND_NAME, LOGO_BUBBLE_PATH, LOGO_W_POINTS } from "@/lib/brand";

/**
 * Brand mark: white chat bubble with a "W", on the accent colour.
 * Follows the active theme via `bg-primary` / `text-primary`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="h-[78%] w-[78%]" aria-hidden="true">
        <path d={LOGO_BUBBLE_PATH} fill="#ffffff" />
        <polyline
          points={LOGO_W_POINTS}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** Mark + product name, for auth screens and other standalone pages.
 *  Links back to the public website. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label={`${BRAND_NAME} home`}
      className={cn("flex items-center justify-center gap-2.5", className)}
    >
      <LogoMark className="h-10 w-10 rounded-xl" />
      <span className="text-xl font-semibold tracking-tight text-foreground">
        {BRAND_NAME}
      </span>
    </Link>
  );
}
