"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p>The overlay encountered an error and needs to be refreshed.</p>
          <button 
            onClick={() => window.location.reload()}
            className="error-reload-btn"
          >
            Reload Page
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className="error-details">
              <summary>Error Details (Development)</summary>
              <pre>{this.state.error.stack}</pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook-based error boundary for functional components
export function useErrorHandler() {
  return React.useCallback((error: Error, errorInfo?: ErrorInfo) => {
    console.error('Error caught by useErrorHandler:', error, errorInfo);
    // You can add error reporting logic here
  }, []);
} 