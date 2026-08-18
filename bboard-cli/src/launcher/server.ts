// This file is part of wbaxterh/vouched.
// Portions derived from midnightntwrk/example-bboard.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/*
 * Local demo backend for the vouched web UI. Wraps the same standalone
 * devnet machinery the CLI and e2e use (docker devnet, genesis wallet,
 * VouchedAPI) and exposes it over a small localhost HTTP API so the
 * browser never needs a wallet extension or any Midnight libraries.
 *
 *   GET  /api/status  -> { phase, contractAddress?, error? }
 *   GET  /api/state   -> public ledger view + event log
 *   POST /api/buy     -> { product }            => { commitment }
 *   POST /api/review  -> { product, rating, text } => 200 | 409 { error }
 *
 * Mutating calls are serialized through a queue: the level private state
 * provider takes an exclusive lock per operation, so concurrent contract
 * calls from the browser would otherwise collide.
 */

import http from 'node:http';
import { WebSocket } from 'ws';
import {
  VouchedAPI,
  type VouchedProviders,
  type VouchedCircuitKeys,
  type PrivateStateId,
  productIdFromName,
  productNameFromId,
} from '../../../api/src/index';
import { type WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { MidnightWalletProvider } from '../midnight-wallet-provider';
import { waitForUnshieldedFunds } from '../wallet-utils';
import { getVouchedLedgerState } from '../index.js';
import { createLogger } from '../logger-utils.js';
import { StandaloneConfig } from '../config.js';
import { type VouchedPrivateState } from '../../../contract/src/witnesses.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const PORT = 7302;
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const config = new StandaloneConfig();
const logger = await createLogger(config.logDir);
const testEnv = config.getEnvironment(logger);

interface DemoEvent {
  at: string;
  kind: 'deploy' | 'buy' | 'review' | 'reject';
  message: string;
}

let phase: 'starting' | 'ready' | 'failed' = 'starting';
let startupError: string | undefined;
let api: VouchedAPI | undefined;
let providers: VouchedProviders | undefined;
const commitments: string[] = [];
const events: DemoEvent[] = [];

const record = (kind: DemoEvent['kind'], message: string) => {
  events.push({ at: new Date().toISOString(), kind, message });
  logger.info(`[${kind}] ${message}`);
};

/*
 * Serialize contract calls: the level private state store is locked per
 * operation, so overlapping callTx invocations fail with 'Database
 * failed to open'.
 */
let queueTail: Promise<unknown> = Promise.resolve();
const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
  const next = queueTail.then(op, op);
  queueTail = next.catch(() => undefined);
  return next;
};

/*
 * Turn a contract call failure into the message the demo should show.
 * Circuit asserts surface as "failed assert: <reason>"; a witness that
 * cannot find the purchase commitment surfaces as a generic
 * ContractRuntimeError on postReview.
 */
const rejectionReason = (raw: string): string => {
  const assertMatch = /failed assert: ([^']+)/.exec(raw);
  if (assertMatch !== null) {
    return assertMatch[1];
  }
  if (raw.includes("Error executing circuit 'postReview'")) {
    return 'no verified purchase of this product in this wallet';
  }
  return raw;
};

const startup = async (): Promise<void> => {
  const envConfiguration = await testEnv.start();
  logger.info(`Environment started: ${JSON.stringify(envConfiguration)}`);

  const walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, GENESIS_MINT_WALLET_SEED);
  const walletFacade: WalletFacade = walletProvider.wallet;
  await walletProvider.start();
  await waitForUnshieldedFunds(logger, walletFacade, envConfiguration, unshieldedToken());

  const zkConfigProvider = new NodeZkConfigProvider<VouchedCircuitKeys>(config.zkConfigPath);
  providers = {
    privateStateProvider: levelPrivateStateProvider<PrivateStateId, VouchedPrivateState>({
      privateStateStoreName: config.privateStateStoreName,
      signingKeyStoreName: `${config.privateStateStoreName}-signing-keys`,
      privateStoragePasswordProvider: () => {
        return 'Vouched-Test-2026!';
      },
      accountId: GENESIS_MINT_WALLET_SEED,
    }),
    publicDataProvider: indexerPublicDataProvider(envConfiguration.indexer, envConfiguration.indexerWS),
    zkConfigProvider: zkConfigProvider,
    proofProvider: httpClientProofProvider(envConfiguration.proofServer, zkConfigProvider),
    walletProvider: walletProvider,
    midnightProvider: walletProvider,
  };

  api = await VouchedAPI.deploy(providers, logger);
  record('deploy', `vouched contract deployed at ${api.deployedContractAddress}`);
  phase = 'ready';
};

const readBody = (req: http.IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/api/status') {
      json(res, 200, { phase, contractAddress: api?.deployedContractAddress, error: startupError });
      return;
    }

    if (api === undefined || providers === undefined) {
      json(res, 503, { error: 'backend still starting the devnet' });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/state') {
      const ledgerState = await getVouchedLedgerState(providers, api.deployedContractAddress);
      if (ledgerState === null) {
        json(res, 500, { error: 'contract state not found' });
        return;
      }
      const reviews = [];
      for (const [nullifier, text] of ledgerState.reviewTexts) {
        reviews.push({
          nullifier: toHex(nullifier),
          product: productNameFromId(ledgerState.reviewProducts.lookup(nullifier)),
          rating: Number(ledgerState.reviewRatings.lookup(nullifier)),
          text,
        });
      }
      json(res, 200, {
        purchaseCount: Number(ledgerState.purchases.firstFree()),
        reviewCount: Number(ledgerState.reviewCount),
        reviews,
        commitments,
        events,
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/buy') {
      const { product } = JSON.parse(await readBody(req)) as { product?: string };
      if (typeof product !== 'string' || product.length === 0) {
        json(res, 400, { error: 'product is required' });
        return;
      }
      const vouchedApi = api;
      const commitment = await enqueue(async () => {
        const derived = await vouchedApi.commitmentFor(productIdFromName(product));
        await vouchedApi.recordPurchase(derived);
        return derived;
      });
      const hex = toHex(commitment);
      commitments.push(hex);
      record('buy', `purchase recorded on-chain as commitment ${hex.slice(0, 16)}... (product not revealed)`);
      json(res, 200, { commitment: hex });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/review') {
      const { product, rating, text } = JSON.parse(await readBody(req)) as {
        product?: string;
        rating?: number;
        text?: string;
      };
      if (typeof product !== 'string' || product.length === 0 || typeof text !== 'string' || !Number.isInteger(rating)) {
        json(res, 400, { error: 'product, rating and text are required' });
        return;
      }
      const vouchedApi = api;
      try {
        await enqueue(() => vouchedApi.postReview(productIdFromName(product), BigInt(rating as number), text));
        record('review', `review of '${product}' accepted with a ZK proof of purchase`);
        json(res, 200, {});
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        const reason = rejectionReason(raw);
        record('reject', `review of '${product}' rejected: ${reason}`);
        json(res, 409, { error: reason, detail: raw });
      }
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  logger.info(`vouched demo backend listening on http://127.0.0.1:${PORT}`);
});

const shutdown = async () => {
  logger.info('Shutting down...');
  server.close();
  try {
    await testEnv.shutdown();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

try {
  await startup();
  logger.info('Backend ready: contract deployed, UI can connect.');
} catch (e) {
  phase = 'failed';
  startupError = e instanceof Error ? e.message : String(e);
  logger.error(`Startup failed: ${startupError}`);
}
