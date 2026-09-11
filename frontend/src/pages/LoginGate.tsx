import { useState } from 'react';
import { Button, Card, Center, PasswordInput, Stack, TextInput, Title, Text } from '@mantine/core';
import { api, setToken } from '../api/client';

export function LoginGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { token } = await api.login(username, password);
      setToken(token);
      onAuthenticated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Center h="100vh">
      <Card w={360} p="xl" component="form" onSubmit={submit}>
        <Stack>
          <Title order={3}>Camera Mosaic Platform</Title>
          <Text size="sm" c="dimmed">
            Sign in to continue.
          </Text>
          <TextInput
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            autoFocus
          />
          <PasswordInput
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          {error ? (
            <Text size="sm" c="red">
              {error}
            </Text>
          ) : null}
          <Button type="submit" loading={loading} fullWidth>
            Sign in
          </Button>
        </Stack>
      </Card>
    </Center>
  );
}
