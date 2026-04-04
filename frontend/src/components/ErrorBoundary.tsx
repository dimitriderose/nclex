import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    fetch('/api/errors/report', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        componentStack: errorInfo.componentStack ?? '',
        url: window.location.href,
      }),
    }).catch(() => {
      // fire-and-forget: do not let reporting failure propagate
    })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#666', margin: '1rem 0' }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              padding: '0.5rem 1.5rem',
              fontSize: '1rem',
              cursor: 'pointer',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: '#007bff',
              color: '#fff',
            }}
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
