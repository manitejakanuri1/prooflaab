import Editor from "@monaco-editor/react";

interface CodeSnapshotProps {
  language: string;
  code: string;
}

// A read-only, syntax-highlighted "code screenshot" for steps whose language
// can't run in the live StackBlitz sandbox (Python, SQL, Java, shell...).
// Reuses the Monaco editor already loaded for the coding assessment instead
// of pulling in a separate highlighter — same look, no new dependency.
const CodeSnapshot = ({ language, code }: CodeSnapshotProps) => {
  const lineCount = code.split("\n").length;
  const height = Math.min(400, Math.max(80, lineCount * 19 + 24));

  return (
    <div className="rounded-lg overflow-hidden border">
      <Editor
        height={`${height}px`}
        language={language}
        value={code}
        theme="vs-dark"
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          renderLineHighlight: "none",
          contextmenu: false,
          folding: false,
          overviewRulerLanes: 0,
        }}
      />
    </div>
  );
};

export default CodeSnapshot;
