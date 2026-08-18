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

/**
 * Types and utilities for working with the vouched verified-purchase
 * reviews contract.
 *
 * @packageDocumentation
 */

import * as Vouched from '../../contract/src/managed/vouched/contract/index.js';

import { type ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type Logger } from 'pino';
import {
  type VouchedDerivedState,
  type VouchedReview,
  type VouchedContract,
  type VouchedProviders,
  type DeployedVouchedContract,
  vouchedPrivateStateKey,
} from './common-types.js';
import { CompiledVouchedContract } from '../../contract/src/index';
import * as utils from './utils/index.js';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { combineLatest, map, tap, from, type Observable } from 'rxjs';
import { toHex } from '@midnight-ntwrk/midnight-js-utils';
import { VouchedPrivateState, createVouchedPrivateState } from '../../contract/src/witnesses.js';

/**
 * Encodes a human-readable product name as the 32-byte product id the
 * contract expects: UTF-8 bytes, zero-padded (and truncated) to 32.
 */
export const productIdFromName = (name: string): Uint8Array => {
  const id = new Uint8Array(32);
  id.set(new TextEncoder().encode(name).slice(0, 32));
  return id;
};

/**
 * An API for a deployed vouched contract.
 */
export interface DeployedVouchedAPI {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Observable<VouchedDerivedState>;

  /** Store side: record a buyer-supplied purchase commitment at checkout. */
  recordPurchase: (commitment: Uint8Array) => Promise<void>;
  /** Buyer side: derive this wallet's commitment for a product (no proof, off-chain). */
  commitmentFor: (productId: Uint8Array) => Promise<Uint8Array>;
  /** Buyer side: post a review backed by a ZK membership proof. */
  postReview: (productId: Uint8Array, rating: bigint, text: string) => Promise<void>;
}

/**
 * Implements {@link DeployedVouchedAPI} by adapting a deployed vouched
 * contract.
 *
 * @remarks
 * The `VouchedPrivateState` holds only the buyer's purchase secret. The
 * store never sees it: at checkout the buyer derives the commitment
 * locally ({@link commitmentFor}) and hands the store that value alone.
 * At review time the secret drives the membership proof and nullifier
 * inside the circuit, so nothing on-chain links the two events.
 */
export class VouchedAPI implements DeployedVouchedAPI {
  /** @internal */
  private constructor(
    public readonly deployedContract: DeployedVouchedContract,
    private readonly providers: VouchedProviders,
    private readonly logger?: Logger,
  ) {
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    providers.privateStateProvider.setContractAddress(this.deployedContractAddress);
    // Read the private state exactly once and share the promise. The level
    // private state provider opens the store with an exclusive lock per
    // operation, so two overlapping reads (e.g. state$ construction racing
    // a commitmentFor call) fail with 'Database failed to open'. The
    // purchase secret never changes during a session, so caching is safe.
    this.privateStatePromise = providers.privateStateProvider.get(
      vouchedPrivateStateKey,
    ) as Promise<VouchedPrivateState>;
    this.state$ = combineLatest(
      [
        providers.publicDataProvider.contractStateObservable(this.deployedContractAddress, { type: 'latest' }).pipe(
          map((contractState) => Vouched.ledger(contractState.data)),
          tap((ledgerState) =>
            logger?.trace({
              ledgerStateChanged: {
                purchaseCount: ledgerState.purchases.firstFree(),
                reviewCount: ledgerState.reviewCount,
              },
            }),
          ),
        ),
        from(this.privateStatePromise),
      ],
      (ledgerState, _privateState) => {
        const reviews: VouchedReview[] = [];
        for (const [nullifier, text] of ledgerState.reviewTexts) {
          reviews.push({
            nullifier: toHex(nullifier),
            productId: toHex(ledgerState.reviewProducts.lookup(nullifier)),
            rating: ledgerState.reviewRatings.lookup(nullifier),
            text,
          });
        }

        return {
          purchaseCount: ledgerState.purchases.firstFree(),
          reviewCount: ledgerState.reviewCount,
          reviews,
        };
      },
    );
  }

  readonly deployedContractAddress: ContractAddress;

  readonly state$: Observable<VouchedDerivedState>;

  private readonly privateStatePromise: Promise<VouchedPrivateState>;

  async recordPurchase(commitment: Uint8Array): Promise<void> {
    this.logger?.info(`recordingPurchase: ${toHex(commitment)}`);

    const txData = await this.deployedContract.callTx.recordPurchase(commitment);

    this.logger?.trace({
      transactionAdded: {
        circuit: 'recordPurchase',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  async commitmentFor(productId: Uint8Array): Promise<Uint8Array> {
    const privateState = await this.privateStatePromise;
    return Vouched.pureCircuits.purchaseCommitment(privateState.purchaseSecret, productId);
  }

  async postReview(productId: Uint8Array, rating: bigint, text: string): Promise<void> {
    this.logger?.info(`postingReview: rating=${rating} product=${toHex(productId)}`);

    const txData = await this.deployedContract.callTx.postReview(productId, rating, text);

    this.logger?.trace({
      transactionAdded: {
        circuit: 'postReview',
        txHash: txData.public.txHash,
        blockHeight: txData.public.blockHeight,
      },
    });
  }

  /**
   * Deploys a new vouched contract to the network.
   */
  static async deploy(providers: VouchedProviders, logger?: Logger): Promise<VouchedAPI> {
    logger?.info('deployContract');

    const deployedVouchedContract = await deployContract(providers, {
      compiledContract: CompiledVouchedContract,
      privateStateId: vouchedPrivateStateKey,
      initialPrivateState: createVouchedPrivateState(utils.randomBytes(32)),
    });

    logger?.trace({
      contractDeployed: {
        finalizedDeployTxData: deployedVouchedContract.deployTxData.public,
      },
    });

    return new VouchedAPI(deployedVouchedContract, providers, logger);
  }

  /**
   * Finds an already deployed vouched contract on the network, and joins it.
   */
  static async join(providers: VouchedProviders, contractAddress: ContractAddress, logger?: Logger): Promise<VouchedAPI> {
    logger?.info({
      joinContract: {
        contractAddress,
      },
    });

    const deployedVouchedContract = await findDeployedContract<VouchedContract>(providers, {
      contractAddress,
      compiledContract: CompiledVouchedContract,
      privateStateId: vouchedPrivateStateKey,
      initialPrivateState: await VouchedAPI.getPrivateState(providers, contractAddress),
    });

    logger?.trace({
      contractJoined: {
        finalizedDeployTxData: deployedVouchedContract.deployTxData.public,
      },
    });

    return new VouchedAPI(deployedVouchedContract, providers, logger);
  }

  private static async getPrivateState(
    providers: VouchedProviders,
    contractAddress: ContractAddress,
  ): Promise<VouchedPrivateState> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    const existingPrivateState = await providers.privateStateProvider.get(vouchedPrivateStateKey);
    return existingPrivateState ?? createVouchedPrivateState(utils.randomBytes(32));
  }
}

/**
 * A namespace that represents the exports from the `'utils'` sub-package.
 *
 * @public
 */
export * as utils from './utils/index.js';

export * from './common-types.js';
