import { Card, Group, Text, ThemeIcon } from '@mantine/core';
import type { ReactNode } from 'react';

export function StatCard({
  label,
  value,
  sub,
  icon,
  color = 'brand',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  color?: string;
}) {
  return (
    <Card padding="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Text size="1.7rem" fw={700} lh={1.1} mt={4}>
            {value}
          </Text>
          {sub ? (
            <Text size="xs" c="dimmed" mt={4}>
              {sub}
            </Text>
          ) : null}
        </div>
        {icon ? (
          <ThemeIcon variant="light" color={color} size={38} radius="md">
            {icon}
          </ThemeIcon>
        ) : null}
      </Group>
    </Card>
  );
}
