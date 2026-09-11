import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Center, Loader } from '@mantine/core';
import { AppLayout } from './components/AppLayout';
import { LoginGate } from './pages/LoginGate';
import { DashboardPage } from './pages/DashboardPage';
import { CamerasPage } from './pages/CamerasPage';
import { MosaicsPage } from './pages/MosaicsPage';
import { MosaicDesignerPage } from './pages/MosaicDesignerPage';
import { MediamtxPage } from './pages/MediamtxPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import { api, getToken } from './api/client';

export function App() {
  const [authReady, setAuthReady] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);

  useEffect(() => {
    api
      .authStatus()
      .then((s) => {
        setNeedLogin(s.authEnabled && !getToken());
      })
      .catch(() => setNeedLogin(false))
      .finally(() => setAuthReady(true));
  }, []);

  if (!authReady) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (needLogin) {
    return <LoginGate onAuthenticated={() => setNeedLogin(false)} />;
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/cameras" element={<CamerasPage />} />
        <Route path="/mosaics" element={<MosaicsPage />} />
        <Route path="/mosaics/new" element={<MosaicDesignerPage />} />
        <Route path="/mosaics/:id" element={<MosaicDesignerPage />} />
        <Route path="/mediamtx" element={<MediamtxPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
