import { cn } from "../utils/cn";
import ailaLogo from "../../assets/img/ailaLogo.png";
import ailaIcon from "../../assets/img/ailaIcon.png";
export function AilaLogo({ className, showTagline = false, title = "AILA" }) {
  return (
    <img src={ailaLogo} alt={title} className={cn("h-auto w-50%", className)} title={title} />
  );
}

export function AilaIcon({ className, title = "AILA" }) {
  return (
    <img src={ailaIcon} alt={title} className={cn("h-auto w-full", className)} title={title} />
  );
}
