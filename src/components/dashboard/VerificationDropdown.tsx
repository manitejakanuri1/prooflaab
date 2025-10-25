import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Play, Eye, Shield } from "lucide-react";

interface VerificationDropdownProps {
  proofId: string;
  hasResults: boolean;
  onRunVerification: (proofId: string) => void;
  onViewResults: () => void;
  isRunning?: boolean;
}

const VerificationDropdown = ({ 
  proofId, 
  hasResults, 
  onRunVerification, 
  onViewResults,
  isRunning = false
}: VerificationDropdownProps) => {
  const [open, setOpen] = useState(false);

  const handleRunVerification = () => {
    onRunVerification(proofId);
    setOpen(false);
  };

  const handleViewResults = () => {
    onViewResults();
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button 
          size="sm" 
          variant="outline"
          className="h-7 text-xs"
          disabled={isRunning}
        >
          <Shield className="h-3 w-3 mr-1" />
          {isRunning ? 'Verifying...' : 'Verify'}
          <ChevronDown className="h-3 w-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Verification Options</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem 
          onClick={handleRunVerification}
          disabled={isRunning}
          className="cursor-pointer"
        >
          <Play className="h-4 w-4 mr-2" />
          Run MOSS + AI Check
        </DropdownMenuItem>
        
        {hasResults && (
          <DropdownMenuItem 
            onClick={handleViewResults}
            className="cursor-pointer"
          >
            <Eye className="h-4 w-4 mr-2" />
            View Results
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default VerificationDropdown;
