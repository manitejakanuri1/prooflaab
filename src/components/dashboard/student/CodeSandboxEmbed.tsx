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
    const box = containerRef.current;
    if (!box || Object.keys(files).length === 0) return;
    // The SDK swaps the element it is given for its iframe. Give it a child
    // React does not own; handing it React's own div crashed the whole lesson
    // window when a student moved from one step to a step with a sandbox.
    const host = document.createElement("div");
    box.replaceChildren(host);
    sdk.embedProject(
      host,
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
    ).catch(() => { /* a failed embed leaves the lesson readable */ });
    return () => box.replaceChildren();
  }, [template, files]);

  return <div ref={containerRef} className="rounded-lg overflow-hidden border" />;
};

export default CodeSandboxEmbed;
