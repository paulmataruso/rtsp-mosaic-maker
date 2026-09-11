import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Cool slate + cyan accent — reads like an NVR / VMS console. */
const brand: MantineColorsTuple = [
  '#e6f7ff',
  '#c8e9fb',
  '#98d2f2',
  '#64bae9',
  '#3ba6e2',
  '#219bde',
  '#0b95dd',
  '#0081c4',
  '#0073b0',
  '#00639b',
];

export const theme = createTheme({
  primaryColor: 'brand',
  colors: { brand },
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  headings: { fontWeight: '600' },
  components: {
    Card: { defaultProps: { withBorder: true, shadow: 'sm' } },
    Paper: { defaultProps: { withBorder: true } },
    Badge: { defaultProps: { variant: 'light' } },
    Table: { defaultProps: { highlightOnHover: true, verticalSpacing: 'sm' } },
  },
});
