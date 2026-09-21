import  { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled render error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            padding: '24px',
            margin: '16px',
            borderRadius: '8px',
            background: '#ffebee',
            border: '1px solid #ef9a9a',
            color: '#c62828',
          }}
        >
          <h3 style={{ margin: '0 0 8px 0' }}>
            {this.props.fallbackTitle ?? 'Something went wrong rendering this section.'}
          </h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#555' }}>
            {this.state.error?.message ?? 'An unexpected rendering error occurred.'}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              padding: '6px 14px',
              backgroundColor: '#c62828',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
