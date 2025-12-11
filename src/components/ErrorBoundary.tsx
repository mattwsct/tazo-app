"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  autoReload?: boolean; // Enable automatic reload on error
  reloadDelay?: number; // Delay before auto-reload in milliseconds (default: 5000)
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  private reloadTimer: NodeJS.Timeout | null = null;
  private errorCount = 0;
  private readonly MAX_RELOADS = 3; // Maximum number of auto-reloads before giving up

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
    
    // Auto-reload logic (silent, no countdown)
    if (this.props.autoReload !== false && this.errorCount < this.MAX_RELOADS) {
      this.errorCount++;
      const delay = this.props.reloadDelay ?? 5000; // Default 5 seconds
      
      // Schedule reload silently
      this.reloadTimer = setTimeout(() => {
        console.log(`Auto-reloading page after error (attempt ${this.errorCount}/${this.MAX_RELOADS})...`);
        window.location.reload();
      }, delay);
    } else if (this.errorCount >= this.MAX_RELOADS) {
      console.error('Maximum reload attempts reached. Stopping auto-reload.');
    }
  }

  componentWillUnmount() {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  handleManualReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isAutoReloading = this.props.autoReload !== false && this.errorCount < this.MAX_RELOADS;
      const reloadMessage = this.errorCount >= this.MAX_RELOADS
        ? 'Maximum reload attempts reached. Please refresh manually.'
        : isAutoReloading
        ? 'The overlay encountered an error and will reload automatically...'
        : 'The overlay encountered an error and needs to be refreshed.';

      return (
        <div className="error-boundary" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          color: '#fff',
          padding: '2rem',
          zIndex: 9999,
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>⚠️ Something went wrong</h2>
          <p style={{ marginBottom: '1.5rem', textAlign: 'center', maxWidth: '500px' }}>
            {reloadMessage}
          </p>
          <button 
            onClick={this.handleManualReload}
            className="error-reload-btn"
            style={{
              padding: '0.75rem 1.5rem',
              fontSize: '1rem',
              backgroundColor: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontWeight: '500',
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
          >
            Reload Now
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className="error-details" style={{ marginTop: '2rem', maxWidth: '800px', width: '100%' }}>
              <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>Error Details (Development)</summary>
              <pre style={{ 
                backgroundColor: 'rgba(0, 0, 0, 0.5)', 
                padding: '1rem', 
                borderRadius: '0.25rem',
                overflow: 'auto',
                fontSize: '0.875rem',
                maxHeight: '400px'
              }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
