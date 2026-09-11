import { useEffect, useState } from 'react';
import {
  Modal,
  Stack,
  TextInput,
  Textarea,
  Select,
  Switch,
  Button,
  Group,
  PasswordInput,
  Alert,
  List,
  ThemeIcon,
  Divider,
  Text,
  Collapse,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconX,
  IconPlugConnected,
  IconChevronDown,
} from '@tabler/icons-react';
import { api } from '../api/client';
import type { CameraDto, CameraTestResult, RtspTransport, StreamType } from 'shared';

interface FormValues {
  name: string;
  description: string;
  host: string;
  mainRtspUrl: string;
  subRtspUrl: string;
  username: string;
  password: string;
  transport: RtspTransport;
  enabled: boolean;
}

const empty: FormValues = {
  name: '',
  description: '',
  host: '',
  mainRtspUrl: '',
  subRtspUrl: '',
  username: '',
  password: '',
  transport: 'tcp',
  enabled: true,
};

export function CameraFormModal({
  opened,
  camera,
  onClose,
  onSaved,
}: {
  opened: boolean;
  camera: (CameraDto & { _prefill?: Partial<FormValues> }) | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!camera?.id;
  const form = useForm<FormValues>({
    initialValues: empty,
    validate: {
      name: (v) => (v.trim() ? null : 'Required'),
      host: (v) => (v.trim() ? null : 'Required'),
      mainRtspUrl: (v) => (/^rtsps?:\/\//i.test(v) ? null : 'Must be an rtsp:// URL'),
      subRtspUrl: (v) => (!v || /^rtsps?:\/\//i.test(v) ? null : 'Must be an rtsp:// URL'),
    },
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<StreamType | null>(null);
  const [testResult, setTestResult] = useState<CameraTestResult | null>(null);
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setTestResult(null);
    if (camera?.id) {
      form.setValues({
        name: camera.name,
        description: camera.description,
        host: camera.host,
        mainRtspUrl: camera.mainRtspUrl,
        subRtspUrl: camera.subRtspUrl ?? '',
        username: camera.username,
        password: '',
        transport: camera.transport,
        enabled: camera.enabled,
      });
    } else {
      form.setValues({ ...empty, ...(camera?._prefill ?? {}) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, camera]);

  const runTest = async (streamType: StreamType) => {
    setTesting(streamType);
    setTestResult(null);
    try {
      const overrides = {
        host: form.values.host,
        mainRtspUrl: form.values.mainRtspUrl,
        subRtspUrl: form.values.subRtspUrl || undefined,
        username: form.values.username,
        password: form.values.password || undefined,
        transport: form.values.transport,
      };
      const result = camera?.id
        ? await api.testCamera(camera.id, { streamType, overrides })
        : await api.testCamera('00000000-0000-0000-0000-000000000000', { streamType, overrides }).catch(
            async () => {
              // No id yet: create a scratch test by hitting a temp endpoint is not available,
              // so guide the user to save first.
              throw new Error('Save the camera first, then use Test Connection.');
            },
          );
      setTestResult(result);
    } catch (err) {
      notifications.show({ title: 'Test failed', message: (err as Error).message, color: 'red' });
    } finally {
      setTesting(null);
    }
  };

  const submit = form.onSubmit(async (values) => {
    setSaving(true);
    try {
      const payload = {
        name: values.name,
        description: values.description,
        host: values.host,
        mainRtspUrl: values.mainRtspUrl,
        subRtspUrl: values.subRtspUrl || null,
        username: values.username,
        transport: values.transport,
        enabled: values.enabled,
        ...(values.password ? { password: values.password } : {}),
      };
      if (editing && camera) await api.updateCamera(camera.id, payload);
      else await api.createCamera(payload);
      notifications.show({ message: `Camera ${editing ? 'updated' : 'added'}.`, color: 'teal' });
      onSaved();
    } catch (err) {
      notifications.show({ title: 'Save failed', message: (err as Error).message, color: 'red' });
    } finally {
      setSaving(false);
    }
  });

  return (
    <Modal opened={opened} onClose={onClose} title={editing ? `Edit ${camera?.name}` : 'Add camera'} size="lg">
      <form onSubmit={submit}>
        <Stack>
          <Group grow>
            <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
            <TextInput
              label="IP address / hostname"
              withAsterisk
              placeholder="192.168.1.21"
              {...form.getInputProps('host')}
            />
          </Group>
          <Textarea label="Description" autosize minRows={1} {...form.getInputProps('description')} />

          <TextInput
            label="Main stream RTSP URL"
            withAsterisk
            placeholder="rtsp://192.168.1.21:554/Streaming/Channels/101"
            {...form.getInputProps('mainRtspUrl')}
          />
          <TextInput
            label="Substream RTSP URL"
            description="Recommended for mosaics — lower CPU, bandwidth and memory."
            placeholder="rtsp://192.168.1.21:554/Streaming/Channels/102"
            {...form.getInputProps('subRtspUrl')}
          />

          <Group grow>
            <TextInput label="Username" {...form.getInputProps('username')} />
            <PasswordInput
              label="Password"
              placeholder={editing ? '•••••• (unchanged)' : ''}
              {...form.getInputProps('password')}
            />
          </Group>

          <Group grow>
            <Select
              label="RTSP transport"
              data={[
                { value: 'tcp', label: 'TCP (recommended)' },
                { value: 'udp', label: 'UDP' },
                { value: 'auto', label: 'Auto (prefer TCP)' },
              ]}
              {...form.getInputProps('transport')}
            />
            <Switch
              label="Enabled"
              mt="lg"
              checked={form.values.enabled}
              onChange={(e) => form.setFieldValue('enabled', e.currentTarget.checked)}
            />
          </Group>

          <Divider
            label={
              <Button
                variant="subtle"
                size="compact-xs"
                rightSection={<IconChevronDown size={12} />}
                onClick={() => setAdvanced((v) => !v)}
              >
                Connection test
              </Button>
            }
          />
          <Collapse in={advanced || !!testResult}>
            <Stack gap="xs">
              <Group>
                <Button
                  variant="light"
                  leftSection={<IconPlugConnected size={14} />}
                  loading={testing === 'main'}
                  disabled={!editing}
                  onClick={() => runTest('main')}
                >
                  Test main
                </Button>
                <Button
                  variant="light"
                  leftSection={<IconPlugConnected size={14} />}
                  loading={testing === 'sub'}
                  disabled={!editing || !form.values.subRtspUrl}
                  onClick={() => runTest('sub')}
                >
                  Test substream
                </Button>
                {!editing ? (
                  <Text size="xs" c="dimmed">
                    Save the camera first to run a test.
                  </Text>
                ) : null}
              </Group>
              {testResult ? (
                <Alert color={testResult.ok ? 'teal' : 'red'} title={testResult.summary}>
                  <List spacing={2} size="sm" center>
                    {testResult.steps.map((s) => (
                      <List.Item
                        key={s.step}
                        icon={
                          <ThemeIcon
                            size={18}
                            radius="xl"
                            color={s.skipped ? 'gray' : s.ok ? 'teal' : 'red'}
                          >
                            {s.ok || s.skipped ? <IconCheck size={12} /> : <IconX size={12} />}
                          </ThemeIcon>
                        }
                      >
                        <b>{s.step}</b> — {s.message} <Text span c="dimmed" size="xs">({s.durationMs} ms)</Text>
                      </List.Item>
                    ))}
                  </List>
                </Alert>
              ) : null}
            </Stack>
          </Collapse>

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Add camera'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
