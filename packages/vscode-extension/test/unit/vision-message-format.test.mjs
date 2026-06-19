import { test } from 'node:test';
import assert from 'node:assert/strict';

test('vision: base64 data URL format validation', () => {
  const validFormats = [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD//gA8Q1JFQVRP',
    'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAkA4JZQCdAEO',
  ];

  for (const url of validFormats) {
    assert.match(url, /^data:image\/(png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/, `invalid format: ${url.slice(0, 30)}`);
  }
});

test('vision: images array in chat message matches extension expected shape', () => {
  const images = [
    'data:image/png;base64,abc123',
    'data:image/jpeg;base64,xyz789',
  ];

  assert.ok(Array.isArray(images));
  assert.ok(images.every(s => typeof s === 'string' && s.startsWith('data:')));
});
