import { useTheme } from "next-themes";
import logoLight from "@/assets/logo-light.png";
import logoDark from "@/assets/logo-dark.png";

interface LogoProps {
  className?: string;
  alt?: string;
}

export const Logo = ({ className = "h-10 w-10", alt = "ProofLabAI Logo" }: LogoProps) => {
  const { theme } = useTheme();
  
  return (
    <img 
      src={theme === "dark" ? logoDark : logoLight} 
      alt={alt} 
      className={className}
    />
  );
};
