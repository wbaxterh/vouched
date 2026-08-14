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

/*
 * Two witnesses:
 *
 * - purchaseSecret returns the buyer's secret from private state.
 * - findPurchasePath answers a Merkle path query for a commitment from the
 *   PUBLIC tree state (WitnessContext.ledger). The path itself is private
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
  ): [VouchedPrivateState, ReturnType<Ledger["purchases"]["pathForLeaf"]>] => {
    const path = ledger.purchases.findPathForLeaf(commitment);
    if (path === undefined) {
      throw new Error(
        "no purchase commitment found on-chain for this product and secret",
      );
    }
    return [privateState, path];
  },
};
