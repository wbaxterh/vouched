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

import React, { useCallback, useEffect, useState } from 'react';
import { AppBar, Box, Chip, CircularProgress, Container, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import { Shop, Reviews, ChainView } from './components';
import { getState, getStatus, type DemoState, type DemoStatus } from './api';

const POLL_MS = 3000;

/**
 * The root vouched demo application: a storefront (buy), a reviews page
 * (post with a ZK proof of purchase), and the raw on-chain view.
 */
const App: React.FC = () => {
  const [status, setStatus] = useState<DemoStatus>({ phase: 'starting' });
  const [state, setState] = useState<DemoState | undefined>(undefined);
  const [tab, setTab] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await getStatus();
      setStatus(nextStatus);
      if (nextStatus.phase === 'ready') {
        setState(await getState());
      }
    } catch {
      setStatus({ phase: 'starting', error: 'backend not reachable yet' });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <Box sx={{ background: '#0f0f17', minHeight: '100vh' }}>
      <AppBar position="static" sx={{ background: '#000', px: 2 }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            vouched
          </Typography>
          <Typography variant="body2" sx={{ color: '#a8a8a8', flexGrow: 1 }}>
            verified-purchase reviews on Midnight
          </Typography>
          {status.phase === 'ready' ? (
            <Chip
              label={`contract ${status.contractAddress?.slice(0, 10)}...`}
              size="small"
              sx={{ fontFamily: 'monospace', color: '#7fdc9a', border: '1px solid #2f5a3c' }}
              variant="outlined"
            />
          ) : status.phase === 'failed' ? (
            <Chip label={`backend failed: ${status.error ?? 'unknown'}`} size="small" color="error" />
          ) : (
            <Chip
              icon={<CircularProgress size={14} sx={{ color: '#a8a8a8' }} />}
              label="starting local devnet..."
              size="small"
              variant="outlined"
              sx={{ color: '#a8a8a8' }}
            />
          )}
        </Toolbar>
        <Tabs
          value={tab}
          onChange={(_, next: number) => setTab(next)}
          textColor="inherit"
          sx={{ '& .MuiTab-root': { color: '#a8a8a8' }, '& .MuiTab-root.Mui-selected': { color: 'white' } }}
        >
          <Tab label="Shop" />
          <Tab label="Reviews" />
          <Tab label="What the chain sees" />
        </Tabs>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {tab === 0 && <Shop ready={status.phase === 'ready'} onChanged={refresh} />}
        {tab === 1 && <Reviews ready={status.phase === 'ready'} state={state} onChanged={refresh} />}
        {tab === 2 && <ChainView status={status} state={state} />}
      </Container>
    </Box>
  );
};

export default App;
