import { describe, expect, it } from 'vitest';
import { MinHeap } from '../src/core/routing/minHeap';

describe('MinHeap', () => {
  it('pops in ascending priority order', () => {
    const heap = new MinHeap<number>();
    const values = [5, 3, 9, 1, 7, 2, 8, 6, 4, 0];
    values.forEach((v) => heap.push(v, v));
    const out: number[] = [];
    while (heap.size) out.push(heap.pop()!.item);
    expect(out).toEqual([...values].sort((a, b) => a - b));
  });

  it('matches a sorted array on random input', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const heap = new MinHeap<number>();
    const priorities = Array.from({ length: 500 }, () => Math.floor(rand() * 100));
    priorities.forEach((p, i) => heap.push(i, p));
    const popped: number[] = [];
    while (heap.size) popped.push(heap.pop()!.priority);
    expect(popped).toEqual([...priorities].sort((a, b) => a - b));
  });

  it('breaks ties first-in, first-out', () => {
    const heap = new MinHeap<string>();
    ['a', 'b', 'c', 'd'].forEach((x) => heap.push(x, 1));
    heap.push('first', 0);
    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop(), heap.pop()].map((e) => e!.item)).toEqual([
      'first', 'a', 'b', 'c', 'd',
    ]);
  });

  it('handles empty pops and peeks', () => {
    const heap = new MinHeap<string>();
    expect(heap.pop()).toBeUndefined();
    expect(heap.peek()).toBeUndefined();
    heap.push('x', 3);
    expect(heap.peek()).toEqual({ item: 'x', priority: 3 });
    expect(heap.size).toBe(1);
  });

  it('rejects NaN priorities', () => {
    expect(() => new MinHeap<string>().push('x', NaN)).toThrow(RangeError);
  });
});
