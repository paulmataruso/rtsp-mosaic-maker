import { describe, it, expect } from 'vitest';
import { slugify, validateSlug } from 'shared';

describe('slugify', () => {
  it('turns a display name into a safe path segment', () => {
    expect(slugify('Warehouse Main')).toBe('warehouse-main');
    expect(slugify('  Front Entrance!! ')).toBe('front-entrance');
    expect(slugify('Loading   Dock #2')).toBe('loading-dock-2');
    expect(slugify('Café Terrace')).toBe('cafe-terrace');
  });

  it('collapses non-alphanumerics and trims hyphens', () => {
    expect(slugify('---a___b---')).toBe('a-b');
    expect(slugify('***')).toBe('mosaic');
    expect(slugify('')).toBe('mosaic');
  });
});

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    expect(validateSlug('warehouse').ok).toBe(true);
    expect(validateSlug('warehouse-main').ok).toBe(true);
    expect(validateSlug('lot-42').ok).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(validateSlug('Warehouse').ok).toBe(false); // uppercase
    expect(validateSlug('-lead').ok).toBe(false);
    expect(validateSlug('trail-').ok).toBe(false);
    expect(validateSlug('a--b').ok).toBe(false); // double hyphen
    expect(validateSlug('has space').ok).toBe(false);
    expect(validateSlug('a'.repeat(65)).ok).toBe(false);
  });

  it('rejects reserved names', () => {
    expect(validateSlug('api').ok).toBe(false);
    expect(validateSlug('health').ok).toBe(false);
  });
});
