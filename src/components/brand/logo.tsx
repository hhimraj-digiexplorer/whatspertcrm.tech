import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { BRAND_NAME, LOGO_LOCKUP_SRC, LOGO_MARK_SRC } from "@/lib/brand";

/**
 * Brand mark: the WhatsApp-style bubble with the DigiExplorer "De"
 * monogram (public/brand/logo-mark.png, transparent). Fixed brand
 * artwork — it doesn't follow the accent theme.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative flex h-8 w-8 shrink-0 items-center justify-center",
        className,
      )}
    >
      <Image
        src={LOGO_MARK_SRC}
        alt=""
        aria-hidden="true"
        fill
        sizes="64px"
        className="object-contain"
        priority
      />
    </span>
  );
}

/** Full logo (mark + wordmark + tagline), for auth screens and other
 *  standalone pages. Links back to the public website. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label={`${BRAND_NAME} home`}
      className={cn("flex items-center justify-center", className)}
    >
      <Image
        src={LOGO_LOCKUP_SRC}
        alt={BRAND_NAME}
        width={2001}
        height={469}
        sizes="(max-width: 640px) 80vw, 320px"
        className="h-auto w-[280px] max-w-full sm:w-[320px]"
        priority
      />
    </Link>
  );
}
