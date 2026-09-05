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
 * The private state for vouched is a single purchase secret held in the
 * buyer's wallet. Commitments and nullifiers are derived from it per
 * product, so one secret supports any number of purchases while every
 * on-chain artifact stays unlinkable.
 */

import { Ledger } from "./managed/vouched/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type VouchedPrivateState = {
  readonly purchaseSecret: Uint8Array;
};

export const createVouchedPrivateState = (purchaseSecret: Uint8Array) => ({
  purchaseSecret,
});

/** The Merkle path type the compiler generated for the purchases tree. */
export type PurchasePath = ReturnType<Ledger["purchases"]["pathForLeaf"]>;

/*
 * TEST HOOK, used only by the scripted e2e. Makes findPurchasePath answer
 * with a supplied path for one commitment instead of the path the ledger
 * holds, so a test can hand the circuit a real path for a DIFFERENT leaf
 * and prove that `assert(path.leaf == commitment)` rejects it. Nothing in
 * the API sets this; production callers never touch it.
 */
let forgedPathForTest:
  { readonly commitment: string; readonly path: PurchasePath } | undefined;

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const forgePurchasePathForTest = (
  commitment: Uint8Array,
  path: PurchasePath,
): void => {
  forgedPathForTest = { commitment: hex(commitment), path };
};

export const clearForgedPurchasePathForTest = (): void => {
  forgedPathForTest = undefined;
};

/*
 * Two witnesses:
 *
 * - purchaseSecret returns the buyer's secret from private state.
 * - findPurchasePath answers a Merkle path query for a commitment from the
 *   PUBLIC tree state (WitnessContext.ledger), unless the e2e test hook
 *   above forged one for this commitment. The path itself is private
 *   input to the circuit; only the tree root it hashes to is disclosed.
 */
export const witnesses = {
  purchaseSecret: ({
    privateState,
  }: WitnessContext<Ledger, VouchedPrivateState>): [
    VouchedPrivateState,
    Uint8Array,
  ] => [privateState, privateState.purchaseSecret],

  findPurchasePath: (
    { privateState, ledger }: WitnessContext<Ledger, VouchedPrivateState>,
    commitment: Uint8Array,
  ): [VouchedPrivateState, PurchasePath] => {
    if (
      forgedPathForTest !== undefined &&
      forgedPathForTest.commitment === hex(commitment)
    ) {
      return [privateState, forgedPathForTest.path];
    }
    const path = ledger.purchases.findPathForLeaf(commitment);
    if (path === undefined) {
      throw new Error(
        "no purchase commitment found on-chain for this product and secret",
      );
    }
    return [privateState, path];
  },
};
