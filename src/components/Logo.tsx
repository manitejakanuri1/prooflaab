import { cn } from "@/lib/utils";

// The brand-kit logo (owner decision 25 Oct 2026), served from the public bucket
// gs://prooflab_logo/brand: white artwork on dark pages, navy on light pages. Both
// images are in the page; the html "dark" class decides which one shows.
const LOGO = "https://storage.googleapis.com/prooflab_logo/brand";

function Themed({ name, className, alt, width, height }: { name: string; className: string; alt: string; width: number; height: number }) {
  return (
    <>
      <img src={`${LOGO}/${name}-navy.svg`} alt={alt} className={cn(className, "dark:hidden")} width={width} height={height} />
      <img src={`${LOGO}/${name}-white.svg`} alt={alt} className={cn(className, "hidden dark:block")} width={width} height={height} />
    </>
  );
}

interface LogoProps {
  className?: string;
  alt?: string;
}

/** The P icon. */
export const Logo = ({ className = "h-10 w-10", alt = "ProofLab logo" }: LogoProps) => (
  <span className="inline-flex shrink-0">
    <Themed name="prooflab-icon" className={cn("w-auto", className)} alt={alt} width={1000} height={1000} />
  </span>
);

/** The PROOFLAB word. Pass the display class (e.g. "hidden sm:inline-flex") to hide it on small screens. */
export const Wordmark = ({ className = "inline-flex", imgClassName = "h-3.5" }: { className?: string; imgClassName?: string }) => (
  <span className={cn("items-center", className)}>
    <Themed name="prooflab-wordmark" className={cn("w-auto", imgClassName)} alt="ProofLab" width={900} height={118} />
  </span>
);
