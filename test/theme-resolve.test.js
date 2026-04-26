'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTheme } = require('../lib/theme-resolve');

test('明确偏好 warm-beige：无视系统 dark', () => {
  assert.equal(resolveTheme('warm-beige', true), 'warm-beige');
  assert.equal(resolveTheme('warm-beige', false), 'warm-beige');
});

test('明确偏好 dark-mocha：无视系统 light', () => {
  assert.equal(resolveTheme('dark-mocha', true), 'dark-mocha');
  assert.equal(resolveTheme('dark-mocha', false), 'dark-mocha');
});

test('明确偏好 paper-white：无视系统', () => {
  assert.equal(resolveTheme('paper-white', true), 'paper-white');
  assert.equal(resolveTheme('paper-white', false), 'paper-white');
});

test('明确偏好 midnight：无视系统', () => {
  assert.equal(resolveTheme('midnight', true), 'midnight');
  assert.equal(resolveTheme('midnight', false), 'midnight');
});

test('auto + 系统 dark → dark-mocha', () => {
  assert.equal(resolveTheme('auto', true), 'dark-mocha');
});

test('auto + 系统 light → warm-beige', () => {
  assert.equal(resolveTheme('auto', false), 'warm-beige');
});

test('未知值 fallback warm-beige', () => {
  assert.equal(resolveTheme('solarized', true), 'warm-beige');
  assert.equal(resolveTheme('xyz', false), 'warm-beige');
});

test('null / undefined / 空串 fallback warm-beige', () => {
  assert.equal(resolveTheme(null, true), 'warm-beige');
  assert.equal(resolveTheme(undefined, false), 'warm-beige');
  assert.equal(resolveTheme('', true), 'warm-beige');
});
