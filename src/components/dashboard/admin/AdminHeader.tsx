import { Button } from "@/components/ui/button";
import { Menu, Shield } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface AdminHeaderProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

const AdminHeader = ({ onMenuClick, showMenuButton }: AdminHeaderProps) => {
  return (
    <header className="bg-background/90 backdrop-blur-sm border-b border-border h-16 md:h-20 flex items-center justify-between px-4 md:px-6 dark:bg-card/90">
      <div className="flex items-center space-x-4">
        {showMenuButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onMenuClick}
            className="md:hidden"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-2 rounded-lg">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold">Admin Panel</h1>
            <p className="text-xs md:text-sm text-muted-foreground">Review & Management System</p>
          </div>
        </div>
      </div>
      
      <div className="flex items-center space-x-2">
        <ThemeToggle />
        <div className="bg-primary/10 px-3 py-1 rounded-full">
          <span className="text-xs font-medium text-primary">Admin Access</span>
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;