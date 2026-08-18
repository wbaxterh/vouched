// This file is part of wbaxterh/vouched.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Paper,
  Rating,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import { postReview, PRODUCTS, RejectedError, type DemoState } from '../api';

interface ReviewsProps {
  ready: boolean;
  state: DemoState | undefined;
  onChanged: () => Promise<void>;
}

/**
 * Product reviews. Posting one generates a zero-knowledge proof that
 * this wallet holds a commitment in the on-chain purchase tree for this
 * product. The chain enforces one review per purchase via a nullifier.
 */
export const Reviews: React.FC<ReviewsProps> = ({ ready, state, onChanged }) => {
  const [productId, setProductId] = useState(PRODUCTS[0].id);
  const [rating, setRating] = useState<number>(5);
  const [text, setText] = useState('');
  const [proving, setProving] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | undefined>(undefined);

  const product = PRODUCTS.find((candidate) => candidate.id === productId) ?? PRODUCTS[0];
  const reviews = (state?.reviews ?? []).filter((review) => review.product === productId);

  const handleSubmit = async () => {
    setProving(true);
    setOutcome(undefined);
    try {
      await postReview(productId, rating, text);
      setOutcome({ ok: true, message: 'Review accepted. The chain verified your purchase without learning who you are.' });
      setText('');
      await onChanged();
    } catch (e) {
      const message = e instanceof RejectedError ? e.message : e instanceof Error ? e.message : String(e);
      setOutcome({ ok: false, message: `The chain rejected this review: "${message}"` });
    } finally {
      setProving(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 1, fontWeight: 600 }}>
        Reviews
      </Typography>
      <Typography variant="body1" sx={{ color: '#a8a8a8', mb: 3 }}>
        Every review here is backed by a zero-knowledge proof of purchase. No account, no purchase history exposed, and
        one review per purchase, enforced by the contract, not by moderation.
      </Typography>

      <ToggleButtonGroup
        exclusive
        value={productId}
        onChange={(_, next: string | null) => {
          if (next !== null) {
            setProductId(next);
            setOutcome(undefined);
          }
        }}
        sx={{ mb: 3 }}
      >
        {PRODUCTS.map((candidate) => (
          <ToggleButton key={candidate.id} value={candidate.id} sx={{ color: 'white' }}>
            {candidate.name}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Box sx={{ flex: '1 1 380px' }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {product.name}: {reviews.length === 0 ? 'no reviews yet' : `${reviews.length} verified review${reviews.length === 1 ? '' : 's'}`}
          </Typography>
          {reviews.map((review) => (
            <Paper key={review.nullifier} sx={{ p: 2, mb: 2, background: '#1a1a24', border: '1px solid #2a2a38' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Rating value={review.rating} readOnly size="small" />
                <Chip
                  icon={<VerifiedIcon sx={{ fontSize: 16 }} />}
                  label="verified purchase"
                  size="small"
                  variant="outlined"
                  sx={{ color: '#7fdc9a', borderColor: '#2f5a3c' }}
                />
              </Box>
              <Typography variant="body1">{review.text}</Typography>
              <Typography variant="caption" sx={{ color: '#666', fontFamily: 'monospace' }}>
                by anonymous holder of nullifier {review.nullifier.slice(0, 12)}...
              </Typography>
            </Paper>
          ))}
        </Box>

        <Paper sx={{ flex: '1 1 320px', p: 3, background: '#1a1a24', border: '1px solid #2a2a38' }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Write a review
          </Typography>
          <Rating value={rating} onChange={(_, next) => setRating(next ?? 1)} sx={{ mb: 2 }} />
          <TextField
            fullWidth
            multiline
            minRows={3}
            placeholder={`How is the ${product.name}?`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            sx={{ mb: 2, '& .MuiInputBase-input': { color: 'white' } }}
            data-testid="review-text"
          />
          <Button
            variant="contained"
            fullWidth
            disabled={!ready || proving || text.length === 0}
            onClick={() => void handleSubmit()}
            data-testid="review-submit"
            sx={{ fontWeight: 600 }}
          >
            Post review (proves purchase)
          </Button>
          {outcome !== undefined && (
            <Alert severity={outcome.ok ? 'success' : 'error'} sx={{ mt: 2 }} data-testid="review-outcome">
              {outcome.message}
            </Alert>
          )}
        </Paper>
      </Box>

      <Dialog open={proving}>
        <DialogContent sx={{ textAlign: 'center', p: 5, background: '#1a1a24' }}>
          <CircularProgress sx={{ mb: 2 }} />
          <Typography variant="h6">Proving you bought this product...</Typography>
          <Typography variant="body2" sx={{ color: '#a8a8a8', mt: 1 }}>
            Generating a zero-knowledge membership proof against the on-chain purchase tree. The proof reveals nothing
            about which purchase is yours.
          </Typography>
        </DialogContent>
      </Dialog>
    </Box>
  );
};
