import { useContext, useEffect } from 'react'
import {
  UNSAFE_DataRouterStateContext,
  isRouteErrorResponse,
  useInRouterContext,
  useRouteError,
} from 'react-router-dom'

import { errorReporter } from '@/lib/errorReporter'
import { ErrorFallback } from './ErrorFallback'

type RouteError = unknown

function reportRouteError(error: RouteError) {
  if (!error) return

  let errorMessage = 'Unknown route error'
  let errorStack = ''

  if (isRouteErrorResponse(error)) {
    errorMessage = `Route Error ${error.status}: ${error.statusText}`
    if (error.data) {
      errorMessage += ` - ${JSON.stringify(error.data)}`
    }
  } else if (error instanceof Error) {
    errorMessage = error.message
    errorStack = error.stack || ''
  } else if (typeof error === 'string') {
    errorMessage = error
  } else {
    try {
      errorMessage = JSON.stringify(error)
    } catch {
      errorMessage = String(error)
    }
  }

  errorReporter.report({
    message: errorMessage,
    stack: errorStack,
    url: window.location.href,
    timestamp: new Date().toISOString(),
    source: 'react-router',
    error,
    level: 'error',
  })
}

function RouteErrorBoundaryView({ error }: { error: RouteError }) {
  useEffect(() => {
    reportRouteError(error)
  }, [error])

  if (isRouteErrorResponse(error)) {
    const errorMessage = error.data ? JSON.stringify(error.data, null, 2) : `${error.status} ${error.statusText}`;
    return (
      <ErrorFallback
        error={errorMessage}
        resetErrorBoundary={() => window.location.reload()}
      />
    );
  }

  let errorMessage = 'An unexpected error occurred while loading this page.';
  let errorStack = '';
  
  if (error instanceof Error) {
    errorMessage = error.message;
    errorStack = error.stack || '';
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else {
    try {
      errorMessage = JSON.stringify(error);
    } catch {
      errorMessage = String(error);
    }
  }

  return (
    <ErrorFallback
      error={errorMessage}
      stack={errorStack}
      resetErrorBoundary={() => window.location.reload()}
    />
  );
}

function DataRouterRouteErrorBoundary() {
  const error = useRouteError()
  return <RouteErrorBoundaryView error={error} />
}

export function RouteErrorBoundary() {
  const inRouter = useInRouterContext()
  const dataRouterState = useContext(UNSAFE_DataRouterStateContext)

  const misconfigured = !inRouter || !dataRouterState
  const message = !inRouter
    ? 'Router is not mounted. Add a router at the app root.'
    : 'This router does not support route errors. Use createBrowserRouter + RouterProvider.'

  useEffect(() => {
    if (!misconfigured) return
    errorReporter.report({
      message,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      source: 'react-router',
      level: 'error',
    })
  }, [misconfigured, message])

  // Guard: If this component is rendered outside of a data router (e.g. BrowserRouter)
  // then useRouteError() would throw. Show a friendly fallback instead.
  if (misconfigured) {
    return (
      <ErrorFallback
        error={message}
        resetErrorBoundary={() => window.location.reload()}
      />
    );
  }

  return <DataRouterRouteErrorBoundary />
}