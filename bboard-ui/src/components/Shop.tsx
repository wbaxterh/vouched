// This file is part of wbaxterh/vouched.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CircularProgress,
  Snackbar,
  Typography,
} from '@mui/material';
import { buy, PRODUCTS } from '../api';

interface ShopProps {
  ready: boolean;
  onChanged: () => Promise<void>;
}

/**
 * The storefront. Buying derives a purchase commitment in the buyer's
 * wallet (server-side here, but never on-chain in the clear) and the
 * store records only that opaque value.
 */
export const Shop: React.FC<ShopProps> = ({ ready, onChanged }) => {
  const [buying, setBuying] = useState<string | undefined>(undefined);
  const [bought, setBought] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | undefined>(undefined);

  const handleBuy = async (productId: string) => {
    setBuying(productId);
    setError(undefined);
    try {
      const { commitment } = await buy(productId);
      setBought((prev) => ({ ...prev, [productId]: commitment }));
      setToast('Purchase recorded on-chain. The chain saw only an opaque commitment.');
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuying(undefined);
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 1, fontWeight: 600 }}>
        Board Shop
      </Typography>
      <Typography variant="body1" sx={{ color: '#a8a8a8', mb: 3 }}>
        Checkout records a purchase commitment on-chain. Not the product, not your identity: an opaque 32-byte value
        only your wallet can later prove it owns.
      </Typography>
      {error !== undefined && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {PRODUCTS.map((product) => (
          <Card key={product.id} sx={{ width: 300, background: '#1a1a24', border: '1px solid #2a2a38' }}>
            <CardContent>
              <Typography variant="overline" sx={{ color: '#a8a8a8' }}>
                {product.kind}
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {product.name}
              </Typography>
              <Typography variant="h5" sx={{ mt: 1, color: '#7fdc9a' }}>
                {product.price}
              </Typography>
              {bought[product.id] !== undefined && (
                <Box sx={{ mt: 2, p: 1, background: '#10101a', borderRadius: 1 }}>
                  <Typography variant="caption" sx={{ color: '#a8a8a8', display: 'block' }}>
                    On-chain record (commitment):
                  </Typography>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                    {bought[product.id]}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#7fdc9a', display: 'block', mt: 0.5 }}>
                    Your purchase secret never left the wallet.
                  </Typography>
                </Box>
              )}
            </CardContent>
            <CardActions>
              <Button
                variant="contained"
                fullWidth
                disabled={!ready || buying !== undefined}
                onClick={() => void handleBuy(product.id)}
                data-testid={`buy-${product.id}`}
                sx={{ fontWeight: 600 }}
              >
                {buying === product.id ? (
                  <>
                    <CircularProgress size={18} sx={{ mr: 1 }} /> Recording on-chain...
                  </>
                ) : (
                  'Buy'
                )}
              </Button>
            </CardActions>
          </Card>
        ))}
      </Box>
      <Snackbar
        open={toast !== undefined}
        autoHideDuration={6000}
        onClose={() => setToast(undefined)}
        message={toast}
      />
    </Box>
  );
};
