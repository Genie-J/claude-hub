'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOsc7 } = require('../lib/osc-parser');

test('OSC 7 with hostname', () => {
  const input = '\x1b]7;file://localhost/Users/janet/foo\x07';
  assert.equal(parseOsc7(input), '/Users/janet/foo');
});

test('OSC 7 with empty hostname', () => {
  const input = '\x1b]7;file:///Users/janet/bar\x07';
  assert.equal(parseOsc7(input), '/Users/janet/bar');
});

test('OSC 7 embedded in larger PTY output', () => {
  const input = 'some prompt output\r\n\x1b[32m$ \x1b[0m\x1b]7;file://myhost/Users/janet/projects/hub\x07more text';
  assert.equal(parseOsc7(input), '/Users/janet/projects/hub');
});

test('no OSC 7 returns null', () => {
  assert.equal(parseOsc7('hello world\r\n'), null);
  assert.equal(parseOsc7(''), null);
  assert.equal(parseOsc7('\x1b]133;A\x07'), null); // OSC 133 不该匹配
});

test('multiple OSC 7 returns last (most recent cwd)', () => {
  const input =
    '\x1b]7;file://h/Users/janet/a\x07' +
    'cd b\r\n' +
    '\x1b]7;file://h/Users/janet/b\x07' +
    'cd c\r\n' +
    '\x1b]7;file://h/Users/janet/c\x07';
  assert.equal(parseOsc7(input), '/Users/janet/c');
});

test('OSC 7 with ST terminator (ESC \\)', () => {
  const input = '\x1b]7;file://localhost/Users/janet/qux\x1b\\';
  assert.equal(parseOsc7(input), '/Users/janet/qux');
});

test('OSC 7 with percent-encoded path (中文)', () => {
  // /Users/janet/桌面 percent-encoded
  const input = '\x1b]7;file:///Users/janet/%E6%A1%8C%E9%9D%A2\x07';
  assert.equal(parseOsc7(input), '/Users/janet/桌面');
});

test('non-string input returns null', () => {
  assert.equal(parseOsc7(null), null);
  assert.equal(parseOsc7(undefined), null);
  assert.equal(parseOsc7(123), null);
});
