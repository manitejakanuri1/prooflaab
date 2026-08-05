import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a render error and shows what it was.
 *
 * Without this, React unmounts the whole tree when any component throws and
 * leaves a blank white page. The reason is written to the console and nowhere
 * else, so anyone who did not have devtools open at the moment it happened has
 * no way to tell a crash from a slow load, a bad route, or a failed deploy —
 * which is exactly how one white screen went undiagnosed for a day.
 *
 * A class component because getDerivedStateFromError and componentDidCatch have
 * no hook equivalent; this is the one place React still requires one.
 */

interface Props {
  children: ReactNode;
  /** Names the area that failed, so the message says where rather than just what. */
  area?: string;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * A missing chunk is already handled by installStaleChunkReload, which reloads
 * the page. Showing a crash screen first would beat it to the paint and make a
 * self-healing situation look fatal.
 */
function isStaleChunkError(error: Error): boolean {
  const m = error.message || "";
  return (
    m.includes("Failed to fetch dynamically imported module") ||
    m.includes("error loading dynamically imported module") ||
    m.includes("Importing a module script failed")
  );
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return isStaleChunkError(error) ? { error: null } : { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Render error${this.props.area ? ` in ${this.props.area}` : ""}:`, error, info);
    this.setState({ info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-2xl space-y-4">
          <div>
            <h1 className="text-xl font-semibold">
              Something on this page crashed
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {this.props.area
                ? `The ${this.props.area} failed to render. The rest of the app still works.`
                : "The page failed to render."}
            </p>
          </div>

          {/* The message itself, not a generic apology — it is the only thing
              that makes the problem reportable by someone without devtools. */}
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-sm font-medium mb-1">What went wrong</p>
            <p className="font-mono text-sm break-words">{error.message || String(error)}</p>
          </div>

          {info?.componentStack && (
            <details className="rounded-lg border p-4">
              <summary className="text-sm font-medium cursor-pointer">
                Technical detail
              </summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap overflow-x-auto text-muted-foreground">
                {info.componentStack.trim()}
              </pre>
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
              onClick={() => window.location.reload()}
            >
              Reload the page
            </button>
            <button
              className="rounded-md border px-4 py-2 text-sm font-medium"
              onClick={() => { window.location.href = "/"; }}
            >
              Go to the start
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
