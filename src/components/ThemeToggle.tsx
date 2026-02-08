import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    // Update DOM immediately for instant visual feedback
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(newTheme);
    // Persist and sync with next-themes
    setTheme(newTheme);
  };

  // Read current theme from DOM to avoid hydration mismatch
  const isDark = typeof window !== "undefined" 
    ? document.documentElement.classList.contains("dark")
    : false;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleTheme}
      className="h-9 w-9 p-0"
    >
      {isDark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
};
