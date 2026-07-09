import brandLogo from "@/assets/brand-logo.png";
import { cn } from "@/lib/utils";

interface BrandLoaderProps {
  label?: string;
  fullScreen?: boolean;
  className?: string;
}

export function BrandLoader({
  label = "Loading...",
  fullScreen = true,
  className,
}: BrandLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        fullScreen
          ? "min-h-screen w-full flex items-center justify-center bg-gradient-soft"
          : "w-full flex items-center justify-center py-16",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        <div className="relative">
          {/* Soft pulsing glow behind logo */}
          <div className="absolute inset-0 -m-3 rounded-full bg-primary/20 blur-2xl animate-pulse" />
          <div className="relative w-16 h-16 rounded-2xl bg-card border border-border/60 shadow-elegant flex items-center justify-center overflow-hidden animate-pulse-soft">
            <img
              src={brandLogo}
              alt="Criterion Wellness Home"
              className="w-12 h-12 object-contain"
            />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="font-display font-bold text-lg tracking-tight text-foreground text-center">
            Criterion Wellness Home
          </span>
          {label ? (
            <span className="text-sm text-muted-foreground">{label}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default BrandLoader;
