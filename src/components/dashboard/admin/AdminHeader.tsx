import { Shield } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SidebarTrigger } from "@/components/ui/sidebar";

const AdminHeader = () => {
  return (
    <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border h-14 md:h-16 flex items-center justify-between px-3 md:px-6">
      <div className="flex items-center space-x-2 md:space-x-4">
        <SidebarTrigger />
        
        <div className="flex items-center space-x-2 md:space-x-3">
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 p-1.5 md:p-2 rounded-lg">
            <Shield className="h-4 w-4 md:h-6 md:w-6 text-white" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-base md:text-lg font-bold">Admin Panel</h1>
            <p className="text-xs text-muted-foreground hidden md:block">Review & Management System</p>
          </div>
        </div>
      </div>
      
      <div className="flex items-center space-x-1 md:space-x-2">
        <ThemeToggle />
        <div className="bg-primary/10 px-2 md:px-3 py-1 rounded-full">
          <span className="text-xs font-medium text-primary">Admin</span>
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;