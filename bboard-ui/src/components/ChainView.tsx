// This file is part of wbaxterh/vouched.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';
import { type DemoState, type DemoStatus } from '../api';

interface ChainViewProps {
  status: DemoStatus;
  state: DemoState | undefined;
}

const kindColor: Record<string, string> = {
  deploy: '#8ab4f8',
  buy: '#7fdc9a',
  review: '#7fdc9a',
  reject: '#f28b82',
};

/**
 * The raw public ledger view: what anyone inspecting the chain can see.
 * Opaque purchase commitments on one side, nullifier-keyed reviews on
 * the other, and no field linking the two.
 */
export const ChainView: React.FC<ChainViewProps> = ({ status, state }) => {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 1, fontWeight: 600 }}>
        What the chain sees
      </Typography>
      <Typography variant="body1" sx={{ color: '#a8a8a8', mb: 3 }}>
        This is the entire public state of contract{' '}
        <Box component="span" sx={{ fontFamily: 'monospace' }}>
          {status.contractAddress ?? '...'}
        </Box>
        . Reviews are public, that is the product. What is missing is the link: no purchase, no wallet, no identity is
        attached to any of them.
      </Typography>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start', mb: 3 }}>
        <Paper sx={{ flex: '1 1 380px', p: 3, background: '#1a1a24', border: '1px solid #2a2a38' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Purchase commitments: {state?.purchaseCount ?? 0}
          </Typography>
          <Typography variant="caption" sx={{ color: '#a8a8a8', display: 'block', mb: 2 }}>
            Leaves of a Merkle tree. Each is hash(tag, product, secret); without the secret they reveal nothing.
          </Typography>
          {(state?.commitments ?? []).map((commitment) => (
            <Typography
              key={commitment}
              variant="caption"
              sx={{ fontFamily: 'monospace', display: 'block', wordBreak: 'break-all', color: '#c9c9d9', mb: 1 }}
            >
              {commitment}
            </Typography>
          ))}
        </Paper>

        <Paper sx={{ flex: '1 1 380px', p: 3, background: '#1a1a24', border: '1px solid #2a2a38' }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Reviews by nullifier: {state?.reviewCount ?? 0}
          </Typography>
          <Typography variant="caption" sx={{ color: '#a8a8a8', display: 'block', mb: 2 }}>
            The nullifier is a one-way tag of (product, secret). It blocks double reviews, but cannot be matched to any
            commitment on the left.
          </Typography>
          {(state?.reviews ?? []).map((review) => (
            <Box key={review.nullifier} sx={{ mb: 2 }}>
              <Typography
                variant="caption"
                sx={{ fontFamily: 'monospace', display: 'block', wordBreak: 'break-all', color: '#c9c9d9' }}
              >
                {review.nullifier}
              </Typography>
              <Typography variant="caption" sx={{ color: '#a8a8a8' }}>
                product={review.product} rating={review.rating} text=&quot;{review.text}&quot;
              </Typography>
            </Box>
          ))}
        </Paper>
      </Box>

      <Paper sx={{ p: 3, background: '#1a1a24', border: '1px solid #2a2a38' }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Contract event log
        </Typography>
        {[...(state?.events ?? [])].reverse().map((event, index) => (
          <Box key={`${event.at}-${index}`} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', mb: 1 }}>
            <Typography variant="caption" sx={{ color: '#666', fontFamily: 'monospace', flexShrink: 0 }}>
              {event.at.slice(11, 19)}
            </Typography>
            <Chip
              label={event.kind}
              size="small"
              variant="outlined"
              sx={{ color: kindColor[event.kind] ?? '#a8a8a8', borderColor: '#2a2a38', flexShrink: 0 }}
            />
            <Typography variant="body2" sx={{ color: '#c9c9d9' }}>
              {event.message}
            </Typography>
          </Box>
        ))}
      </Paper>
    </Box>
  );
};
