import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catches render-time crashes so the app shows the actual error instead of a
 * blank white screen. Without this, any thrown error in a route unmounts the
 * whole tree and renders nothing.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface it in the console too, for the dev tools.
    console.error("Uncaught render error:", error, info);
    this.setState({ info });
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, info: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#0b0f19", color: "#e5e7eb", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <div style={{ maxWidth: 720, width: "100%" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "#f87171" }}>
            Something crashed while rendering this page
          </h1>
          <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 16 }}>
            The error below is what stopped the page from loading.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#111827", border: "1px solid #374151", borderRadius: 8, padding: 16, fontSize: 13, lineHeight: 1.5, maxHeight: 360, overflow: "auto" }}>
            {this.state.error?.name}: {this.state.error?.message}
            {"\n\n"}
            {this.state.error?.stack}
            {this.state.info?.componentStack ? "\n\nComponent stack:" + this.state.info.componentStack : ""}
          </pre>
          <button onClick={this.handleReload} style={{ marginTop: 16, padding: "10px 18px", background: "#2563eb", color: "white", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
