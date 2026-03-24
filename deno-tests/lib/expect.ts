/**
 * Minimal vitest-compatible expect() shim for node:test.
 */
import assert from 'node:assert/strict';

export function expect(val: unknown, _msg?: string) {
  const self = {
    toBe(exp: unknown)         { assert.equal(val, exp); },
    toEqual(exp: unknown)      { assert.deepEqual(val, exp); },
    toStrictEqual(exp: unknown){ assert.deepStrictEqual(val, exp); },
    toBeNull()                 { assert.equal(val, null); },
    toBeDefined()              { assert.notEqual(val, undefined); },
    toBeUndefined()            { assert.equal(val, undefined); },
    toBeTruthy()               { assert.ok(val); },
    toBeFalsy()                { assert.ok(!val); },
    toBeInstanceOf(cls: new (...a: any[]) => unknown) {
      assert.ok(val instanceof cls, `Expected ${String(val)} to be instanceof ${cls.name}`);
    },
    toBeGreaterThan(n: number)        { assert.ok((val as number) > n, `${String(val)} > ${n}`); },
    toBeGreaterThanOrEqual(n: number) { assert.ok((val as number) >= n, `${String(val)} >= ${n}`); },
    toBeLessThan(n: number)           { assert.ok((val as number) < n, `${String(val)} < ${n}`); },
    toBeLessThanOrEqual(n: number)    { assert.ok((val as number) <= n, `${String(val)} <= ${n}`); },
    toHaveLength(n: number) {
      assert.equal((val as unknown[]).length, n,
        `length: expected ${n} got ${(val as unknown[]).length}`);
    },
    toBeCloseTo(n: number, digits = 2) {
      const eps = 0.5 * Math.pow(10, -digits);
      assert.ok(Math.abs((val as number) - n) < eps,
        `${String(val)} ≈ ${n} (±${eps})`);
    },
    toMatch(pattern: RegExp | string) {
      if (typeof pattern === 'string') {
        assert.ok(String(val).includes(pattern),
          `"${String(val)}" does not match "${pattern}"`);
      } else {
        assert.ok(pattern.test(String(val)),
          `"${String(val)}" does not match ${pattern}`);
      }
    },
    toContain(item: unknown) {
      if (Array.isArray(val))
        assert.ok(val.includes(item),
          `${JSON.stringify(val)} does not contain ${JSON.stringify(item)}`);
      else
        assert.ok(String(val).includes(String(item)),
          `"${String(val)}" does not contain "${String(item)}"`);
    },
    toMatchObject(obj: Record<string, unknown>) {
      for (const [k, v] of Object.entries(obj)) {
        assert.equal(
          (val as Record<string, unknown>)[k], v,
          `${k}: expected ${String(v)} got ${String((val as Record<string, unknown>)[k])}`
        );
      }
    },
    toThrow(clsOrMsg?: (new (...a: any[]) => Error) | string) {
      assert.ok(typeof val === 'function', 'toThrow: expected a function');
      try { (val as () => void)(); assert.fail('Expected to throw'); }
      catch (e) {
        if (e instanceof assert.AssertionError) throw e;
        if (typeof clsOrMsg === 'string') {
          assert.ok(
            String((e as Error)?.message).includes(clsOrMsg),
            `Expected error message to contain "${clsOrMsg}", got: "${String((e as Error)?.message)}"`
          );
        } else if (clsOrMsg && !(e instanceof clsOrMsg)) {
          assert.fail(`Expected ${clsOrMsg.name}, got ${(e as Error)?.constructor?.name}: ${(e as Error)?.message}`);
        }
      }
    },
    toThrowError(clsOrMsg?: (new (...a: any[]) => Error) | string) { return self.toThrow(clsOrMsg); },
    not: {
      toBe(exp: unknown)      { assert.notEqual(val, exp); },
      toEqual(exp: unknown)   { assert.notDeepEqual(val, exp); },
      toBeNull()              { assert.notEqual(val, null); },
      toBeDefined()           { assert.equal(val, undefined); },
    toBeInstanceOf(cls: new (...a: any[]) => unknown) {
        assert.ok(!(val instanceof cls),
          `Expected ${String(val)} NOT to be instanceof ${cls.name}`);
      },
      toContain(item: unknown) {
        if (Array.isArray(val))
          assert.ok(!val.includes(item),
            `should not contain ${JSON.stringify(item)}`);
        else
          assert.ok(!String(val).includes(String(item)),
            `"${String(val)}" should not contain "${String(item)}"`);
      },
      toHaveLength(n: number) {
        assert.notEqual((val as unknown[]).length, n);
      },
      toThrow() {
        assert.ok(typeof val === 'function', 'not.toThrow: expected a function');
        try { (val as () => void)(); }
        catch (e) {
          assert.fail(`Expected not to throw, but threw: ${(e as Error)?.message}`);
        }
      },
    },
  };
  return self;
}
