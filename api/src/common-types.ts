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
 * Vouched common types and abstractions.
 *
 * @module
 */

import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { VouchedPrivateState, Contract, Witnesses } from '../../contract/src/index';

export const vouchedPrivateStateKey = 'vouchedPrivateState';
export type PrivateStateId = typeof vouchedPrivateStateKey;

/**
 * Schema of all private states used by the application: one key, the
 * buyer's purchase secret.
 *
 * @public
 */
export type PrivateStates = {
  readonly vouchedPrivateState: VouchedPrivateState;
};

/**
 * The vouched contract with its private state and witnesses.
 *
 * @public
 */
export type VouchedContract = Contract<VouchedPrivateState, Witnesses<VouchedPrivateState>>;

/**
 * The keys of the impure circuits exported from {@link VouchedContract}.
 *
 * @public
 */
export type VouchedCircuitKeys = Exclude<keyof VouchedContract['impureCircuits'], number | symbol>;

/**
 * The providers required by {@link VouchedContract}.
 *
 * @public
 */
export type VouchedProviders = MidnightProviders<VouchedCircuitKeys, PrivateStateId, VouchedPrivateState>;

/**
 * A {@link VouchedContract} that has been deployed to the network.
 *
 * @public
 */
export type DeployedVouchedContract = FoundContract<VouchedContract>;

/**
 * A single verified review as read back from the public ledger. Every field
 * is public by construction; none of them can be linked to the purchase
 * that authorized it.
 */
export type VouchedReview = {
  /** Hex-encoded nullifier that keys this review on-chain. */
  readonly nullifier: string;
  /** Hex-encoded 32-byte product id the review is for. */
  readonly productId: string;
  readonly rating: bigint;
  readonly text: string;
};

/**
 * The derived combination of public ledger state and the current user's
 * private state.
 */
export type VouchedDerivedState = {
  /** Number of purchase commitments recorded (Merkle tree leaves used). */
  readonly purchaseCount: bigint;
  readonly reviewCount: bigint;
  readonly reviews: VouchedReview[];
};
