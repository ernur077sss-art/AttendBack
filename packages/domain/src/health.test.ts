import { expect, test } from 'vitest';
test('test runner is ready', () => {
  expect(process.versions.node.split('.')[0]).toBe('24');
});
