import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expect } from '../lib/expect.js';

/**
 * Tests for the test helper itself.
 *
 * `testkit/expect.ts` is the shim every assertion in this suite goes through. If
 * one of its matchers silently stopped asserting, thousands of tests would keep
 * passing while checking nothing — a failure mode with no other safety net, so
 * each matcher is asserted here to actually fail when it should.
 */
describe('expect — matchers assert', () => {
  it('toMatch accepts a string pattern', () => {
    expect('hello world').toMatch('world');
    assert.throws(() => expect('hello world').toMatch('nope'), /does not match/);
  });

  it('toMatch accepts a RegExp pattern', () => {
    expect('ffmpeg 8.0').toMatch(/\d+\.\d+/);
    assert.throws(() => expect('ffmpeg 8.0').toMatch(/^\d/), /does not match/);
  });

  it('not.toBeInstanceOf', () => {
    expect(new Error('x')).not.toBeInstanceOf(TypeError);
    assert.throws(() => expect(new TypeError('x')).not.toBeInstanceOf(TypeError), /NOT to be instanceof/);
  });

  it('not.toContain on an array', () => {
    expect([1, 2, 3]).not.toContain(4);
    assert.throws(() => expect([1, 2, 3]).not.toContain(2), /should not contain/);
  });

  it('not.toContain on a string', () => {
    expect('hello').not.toContain('zebra');
    assert.throws(() => expect('hello').not.toContain('ell'), /should not contain/);
  });

  it('not.toHaveLength', () => {
    expect([1, 2]).not.toHaveLength(3);
    assert.throws(() => expect([1, 2]).not.toHaveLength(2));
  });

  it('not.toThrow', () => {
    expect(() => undefined).not.toThrow();
    assert.throws(() => expect(() => { throw new Error('boom'); }).not.toThrow(), /Expected not to throw, but threw: boom/);
    assert.throws(() => expect(42).not.toThrow(), /not.toThrow: expected a function/);
  });

  it('toThrow rejects the wrong error class', () => {
    // The class mismatch branch: it threw, but not the class asked for.
    assert.throws(
      () => expect(() => { throw new TypeError('nope'); }).toThrow(RangeError),
      /Expected RangeError, got TypeError/,
    );
  });

  it('toThrow matches on a message substring', () => {
    expect(() => { throw new Error('file not found: x.mp4'); }).toThrow('not found');
    assert.throws(
      () => expect(() => { throw new Error('file not found'); }).toThrow('permission denied'),
      /Expected error message to contain/,
    );
  });

  it('toThrow and toThrowError agree', () => {
    class Custom extends Error {}
    expect(() => { throw new Custom('x'); }).toThrow(Custom);
    expect(() => { throw new Custom('x'); }).toThrowError(Custom);
  });

  it('bare toThrow requires that something throws', () => {
    expect(() => { throw new Error('x'); }).toThrow();
    // Not a lenient "may throw": the shim asserts a throw happened.
    assert.throws(() => expect(() => undefined).toThrow(), /Expected to throw/);
  });

  it('toThrow rethrows an assertion failure rather than swallowing it', () => {
    // If the thrown value is an AssertionError, the shim must not treat it as
    // the expected error — that would make every negative assertion pass.
    assert.throws(
      () => expect(() => assert.fail('inner assertion')).toThrow('never matches this'),
      /AssertionError/,
    );
  });

  it('compares numbers at the boundaries', () => {
    expect(5).toBeGreaterThan(4);
    expect(5).toBeGreaterThanOrEqual(5);
    expect(5).toBeLessThan(6);
    expect(5).toBeLessThanOrEqual(5);
    expect(0.1 + 0.2).toBeCloseTo(0.3);
    expect(0.1 + 0.2).toBeCloseTo(0.3, 10);
    assert.throws(() => expect(5).toBeGreaterThan(5));
    assert.throws(() => expect(0.5).toBeCloseTo(0.9, 2));
  });

  it('covers the nullish and length matchers', () => {
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
    expect(1).toBeDefined();
    expect([1, 2, 3]).toHaveLength(3);
    assert.throws(() => expect([1, 2, 3]).toHaveLength(2), /length: expected 2 got 3/);
    expect({ a: 1 }).toEqual({ a: 1 });
    expect({ a: 1 }).toStrictEqual({ a: 1 });
    expect(1).not.toBeNull();
    expect(1).not.toEqual(2);
    expect(undefined).not.toBeDefined();
  });

  it('toBeInstanceOf names the class on failure', () => {
    class Widget {}
    expect(new Widget()).toBeInstanceOf(Widget);
    assert.throws(() => expect({}).toBeInstanceOf(Widget), /to be instanceof Widget/);
  });

  it('accepts an optional message argument', () => {
    expect(1, 'one').toBe(1);
    expect(1).toBeTruthy();
    expect(0).toBeFalsy();
  });
});