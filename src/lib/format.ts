import type { AssetStatus } from './types';
import { ApiError } from './types';

const UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const STATUS_LABELS: Record<AssetStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  archived: 'Archived',
};

export function statusLabel(status: AssetStatus): string {
  return STATUS_LABELS[status];
}

/**
 * Translates low-level API/network exceptions into clear, actionable copy for reviewers.
 * Strips raw HTTP statuses, socket traces, and leaked backend rate-limit phrases.
 */
export function getHumanErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 429:
        return err.retryAfterSec
          ? `Server is busy. Please wait ${err.retryAfterSec} seconds before trying again.`
          : 'Too many requests were sent in a short window. Please slow down and try again in a few moments.';
      case 503:
        return 'The service is temporarily unavailable. We are attempting to reconnect in the background.';
      case 409:
        return 'This asset was updated by another reviewer. Please reload the newest version before saving.';
      case 400:
        return 'The requested action was rejected due to invalid parameters. Refresh the gallery and try again.';
      case 404:
        return 'The requested asset could not be found or may have been removed.';
      case 0:
        return 'You appear to be offline. Reconnect to the internet to perform actions.';
      default:
        if (err.status >= 500) {
          return 'The server encountered an error processing your request. Please try again shortly.';
        }
    }
  }

  if (typeof err === 'string') {
    if (err.includes('429')) {
      return 'Too many requests were sent in a short window. Please wait a moment and try again.';
    }
    if (err.toLowerCase().includes('failed to fetch') || err.toLowerCase().includes('network')) {
      return 'Unable to contact the server. Please check your internet connection.';
    }
    return err;
  }

  if (err instanceof TypeError && err.message.toLowerCase().includes('failed to fetch')) {
    return 'Unable to contact the server. Please check your internet connection.';
  }

  if (err instanceof Error) {
    return err.message;
  }

  return 'An unexpected error occurred. Please try again.';
}
