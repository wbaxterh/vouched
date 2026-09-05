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
 * Scripted end-to-end run against the standalone devnet. No prompts:
 * deploy, buy, review, then prove the two rejection paths.
 *
 *   1. deploy a fresh vouched contract
 *   2. buy 'skateboard-pro' (derive commitment locally, record on-chain)
 *   3. post a review backed by a ZK membership proof
 *   4. post a second review of the same purchase  -> nullifier rejects it
 *   5. review 'never-bought' with no purchase     -> no Merkle path exists
 *   6. buy 'wheels-set', then review it with the skateboard-pro Merkle
 *      path forged into the witness       -> 'path is not for this purchase'
 *   7. print the public ledger view and a PASS/FAIL verdict
 */

import { WebSocket } from 'ws';
import {
  VouchedAPI,
  vouchedPrivateStateKey,
  type VouchedProviders,
  type VouchedCircuitKeys,
  type PrivateStateId,
  productIdFromName,
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
import {
  type VouchedPrivateState,
  type PurchasePath,
  forgePurchasePathForTest,
  clearForgedPurchasePathForTest,
} from '../../../contract/src/witnesses.js';

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const config = new StandaloneConfig();
const logger = await createLogger(config.logDir);
const testEnv = config.getEnvironment(logger);

let failures = 0;
const check = (label: string, ok: boolean) => {
  logger.info(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) {
    failures += 1;
  }
};

let walletProvider: MidnightWalletProvider | undefined;
try {
  const envConfiguration = await testEnv.start();
  logger.info(`Environment started with configuration: ${JSON.stringify(envConfiguration)}`);

  walletProvider = await MidnightWalletProvider.build(logger, envConfiguration, GENESIS_MINT_WALLET_SEED);
  const walletFacade: WalletFacade = walletProvider.wallet;
  await walletProvider.start();

  const unshieldedState = await waitForUnshieldedFunds(logger, walletFacade, envConfiguration, unshieldedToken());
  const nightBalance = unshieldedState.balances[unshieldedToken().raw];
  if (nightBalance === undefined) {
    throw new Error('No funds received from the genesis wallet');
  }
  logger.info(`Wallet NIGHT balance: ${nightBalance}`);

  const zkConfigProvider = new NodeZkConfigProvider<VouchedCircuitKeys>(config.zkConfigPath);
  const providers: VouchedProviders = {
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

  // 1. deploy
  const api = await VouchedAPI.deploy(providers, logger);
  logger.info(`Deployed vouched contract at: ${api.deployedContractAddress}`);

  // 2. buy: derive the commitment locally, then the store records it
  const productId = productIdFromName('skateboard-pro');
  const commitment = await api.commitmentFor(productId);
  logger.info(`Buyer-derived purchase commitment: ${toHex(commitment)}`);
  await api.recordPurchase(commitment);
  logger.info(`Purchase recorded on-chain.`);

  // wait until the indexer reflects the purchase before proving against it
  const deadline = Date.now() + 60_000;
  for (;;) {
    const state = await getVouchedLedgerState(providers, api.deployedContractAddress);
    if (state !== null && state.purchases.firstFree() > 0n) {
      break;
    }
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the purchase to appear in indexed state');
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  // 3. review with a real ZK membership proof
  logger.info('Posting review (generating zero-knowledge proof of purchase)...');
  await api.postReview(productId, 5n, 'Best deck I have ridden all year');
  logger.info('Review posted.');

  // 4. the same purchase must not review twice: the nullifier is spent
  let duplicateRejected: string | undefined;
  try {
    await api.postReview(productId, 5n, 'Trying to review the same purchase twice');
  } catch (e) {
    duplicateRejected = e instanceof Error ? e.message : String(e);
    logger.info(`Duplicate review rejected: '${duplicateRejected}'`);
  }

  // 5. no purchase, no review: the witness cannot produce a Merkle path
  let unverifiedRejected: string | undefined;
  try {
    await api.postReview(productIdFromName('never-bought'), 4n, 'I never bought this');
  } catch (e) {
    unverifiedRejected = e instanceof Error ? e.message : String(e);
    logger.info(`Unverified review rejected: '${unverifiedRejected}'`);
  }

  // 6. forged witness path: buy a second product, then review it with the
  //    FIRST purchase's Merkle path. Both leaves are real and the path
  //    hashes to the current root, so the only thing between this and a
  //    review the buyer has not earned for that product is the leaf
  //    binding, assert(path.leaf == commitment).
  const otherProductId = productIdFromName('wheels-set');
  const otherCommitment = await api.commitmentFor(otherProductId);
  await api.recordPurchase(otherCommitment);
  logger.info(`Second purchase recorded on-chain: ${toHex(otherCommitment)}`);
  const forgeDeadline = Date.now() + 60_000;
  let forgedPath: PurchasePath | undefined;
  for (;;) {
    const state = await getVouchedLedgerState(providers, api.deployedContractAddress);
    if (state !== null && state.purchases.firstFree() >= 2n) {
      forgedPath = state.purchases.findPathForLeaf(commitment);
      break;
    }
    if (Date.now() > forgeDeadline) {
      throw new Error('Timed out waiting for the second purchase to appear in indexed state');
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (forgedPath === undefined) {
    throw new Error('first purchase is missing from the indexed tree');
  }
  let forgedRejected: string | undefined;
  forgePurchasePathForTest(otherCommitment, forgedPath);
  try {
    await api.postReview(otherProductId, 4n, 'Reviewing wheels-set with the skateboard-pro path');
  } catch (e) {
    forgedRejected = e instanceof Error ? e.message : String(e);
    logger.info(`Forged-path review rejected: '${forgedRejected}'`);
  } finally {
    clearForgedPurchasePathForTest();
  }

  // 7. public ledger view and verdict
  const ledgerState = await getVouchedLedgerState(providers, api.deployedContractAddress);
  if (ledgerState === null) {
    throw new Error('Contract state not found after the run');
  }
  logger.info('== Public ledger state (visible to anyone) ==');
  logger.info(`Purchase commitments recorded: ${ledgerState.purchases.firstFree()}`);
  logger.info(`Reviews posted: ${ledgerState.reviewCount}`);
  for (const [nullifier, text] of ledgerState.reviewTexts) {
    const rating = ledgerState.reviewRatings.lookup(nullifier);
    logger.info(`  review[${toHex(nullifier).slice(0, 8)}..] rating=${rating} text='${text}'`);
  }

  check('review posted with ZK proof', ledgerState.reviewCount === 1n);
  check('duplicate review rejected by nullifier', duplicateRejected !== undefined);
  check('review without purchase rejected', unverifiedRejected !== undefined);
  check(
    "review with another purchase's Merkle path rejected with 'path is not for this purchase'",
    toHex(forgedPath.leaf) === toHex(commitment) &&
      forgedRejected !== undefined &&
      forgedRejected.includes('path is not for this purchase'),
  );
  logger.info(failures === 0 ? 'E2E RESULT: PASS' : `E2E RESULT: FAIL (${failures} failed checks)`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  logger.error(`E2E RESULT: ERROR '${e instanceof Error ? e.message : String(e)}'`);
  if (e instanceof Error) {
    logger.debug(`${e.stack}`);
  }
  process.exitCode = 1;
} finally {
  try {
    if (walletProvider !== undefined) {
      logger.info('Stopping wallet...');
      await walletProvider.stop();
    }
  } finally {
    logger.info('Stopping test environment...');
    await testEnv.shutdown();
  }
}
