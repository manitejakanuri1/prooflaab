import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Polish pass B: a small (i) beside a number; tap or click shows how it is worked out.
 *  The existing popover, not a hover tooltip, so it also opens on a phone. */
const InfoTip = ({ text, label = "How this is worked out" }: { text: string; label?: string }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button type="button" aria-label={label}
              className="inline-flex align-middle text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}>
        <Info className="h-3.5 w-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-64 text-xs leading-relaxed">{text}</PopoverContent>
  </Popover>
);

export default InfoTip;
