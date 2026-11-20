import { describe, expect, it } from 'vitest';

import { getGalleryModalWidth } from './layout';

describe('getGalleryModalWidth', () => {
  it('fits the modal to a small gallery', () => {
    expect(getGalleryModalWidth(1)).toBe('min(95vw, 460px)');
    expect(getGalleryModalWidth(2)).toBe('min(95vw, 460px)');
  });

  it('caps at four columns, the width used when the count is unknown', () => {
    expect(getGalleryModalWidth(12)).toBe('min(95vw, 884px)');
    expect(getGalleryModalWidth()).toBe('min(95vw, 884px)');
  });
});
