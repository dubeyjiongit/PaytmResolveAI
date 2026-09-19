/**
 * PaytmResolve AI — Error Boundary
 * ---------------------------------------------------------------------------
 * Root cause of the "chat goes blank" bug report: an unguarded field access
 * threw during render (see ResolutionCard's old `.recommended_action.replace()`
 * call), and with no error boundary anywhere in the tree, React unmounted
 * everything above it — the whole panel (or, at the top level, the whole
 * app) went white with zero explanation.
 *
 * That specific bug is fixed at its source now, but this boundary exists so
 * the SAME CLASS of bug can never again take the whole app down silently.
 * Any future render-time exception anywhere inside a wrapped subtree is
 * caught, logged to the console for debugging, and replaced with a small,
 * honest "something broke" card with a retry button — never a blank page.
 * ---------------------------------------------------------------------------
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short label shown in the fallback card so it's obvious which part of
   * the app broke (e.g. "AI Teammate chat"). */
  label: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[PaytmResolve AI] ${this.props.label} crashed:`, error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500" />
          <div>
            <p className="text-sm font-semibold text-slate-700">{this.props.label} hit an unexpected error</p>
            <p className="mt-1 text-xs text-slate-500">{this.state.error.message}</p>
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
