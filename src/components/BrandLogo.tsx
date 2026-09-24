type BrandLogoVariant = "rail" | "hero" | "about";

export function BrandLogo({ variant = "rail" }: { variant?: BrandLogoVariant }) {
  return (
    <span className={`brand-logo brand-logo--${variant}`} aria-label="Seven Mail">
      <span className="brand-logo__surface" aria-hidden="true">
        <img src="/seven-mail-logo.svg" alt="" draggable={false} />
      </span>
    </span>
  );
}
