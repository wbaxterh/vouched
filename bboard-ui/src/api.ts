// This file is part of wbaxterh/vouched.
// SPDX-License-Identifier: Apache-2.0

/*
 * Client for the local vouched demo backend (bboard-cli `npm run server`).
 * The browser talks plain HTTP to localhost; all Midnight machinery
 * (wallet, proofs, indexer) lives server-side.
 */

export interface DemoStatus {
  phase: 'starting' | 'ready' | 'failed';
  contractAddress?: string;
  error?: string;
}

export interface DemoReview {
  nullifier: string;
  product: string;
  rating: number;
  text: string;
}

export interface DemoEvent {
  at: string;
  kind: 'deploy' | 'buy' | 'review' | 'reject';
  message: string;
}

export interface DemoState {
  purchaseCount: number;
  reviewCount: number;
  reviews: DemoReview[];
  commitments: string[];
  events: DemoEvent[];
}

export interface Product {
  id: string;
  name: string;
  kind: string;
  price: string;
}

export const PRODUCTS: Product[] = [
  { id: 'street-deck-825', name: 'Street Deck 8.25"', kind: 'Skateboard', price: '$79' },
  { id: 'powder-board-158', name: 'Powder Board 158', kind: 'Snowboard', price: '$449' },
  { id: 'wake-board-139', name: 'Wake Board 139', kind: 'Wakeboard', price: '$389' },
];

export class RejectedError extends Error {
  constructor(
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

const asJson = async (response: Response): Promise<unknown> => {
  const body = (await response.json()) as { error?: string; detail?: string };
  if (!response.ok) {
    throw new RejectedError(body.error ?? `request failed (${response.status})`, body.detail);
  }
  return body;
};

export const getStatus = async (): Promise<DemoStatus> => asJson(await fetch('/api/status')) as Promise<DemoStatus>;

export const getState = async (): Promise<DemoState> => asJson(await fetch('/api/state')) as Promise<DemoState>;

export const buy = async (product: string): Promise<{ commitment: string }> =>
  asJson(
    await fetch('/api/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product }),
    }),
  ) as Promise<{ commitment: string }>;

export const postReview = async (product: string, rating: number, text: string): Promise<void> => {
  await asJson(
    await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, rating, text }),
    }),
  );
};
