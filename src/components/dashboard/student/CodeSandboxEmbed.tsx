import { useEffect, useRef } from "react";
import sdk from "@stackblitz/sdk";

interface CodeSandboxEmbedProps {
  template: "html" | "javascript";
  files: Record<string, string>;
}

// Lives entirely inside our own page — StackBlitz's embed SDK renders an
// iframe in place, the student never navigates to stackblitz.com.
const CodeSandboxEmbed = ({ template, files }: CodeSandboxEmbedProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || Object.keys(files).length === 0) return;
    sdk.embedProject(
      containerRef.current,
      {
        title: "Try it",
        description: "",
        template,
        files,
      },
      {
        height: 380,
        openFile: Object.keys(files)[0],
        view: "default",
        hideExplorer: Object.keys(files).length <= 1,
        hideNavigation: true,
        forceEmbedLayout: true,
        clickToLoad: true,
      },
    );
  }, [template, files]);

  return <div ref={containerRef} className="rounded-lg overflow-hidden border" />;
};

export default CodeSandboxEmbed;
