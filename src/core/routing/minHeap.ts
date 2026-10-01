// A binary min-heap stored in an array.
//
// For the entry at index i, its children are at 2i + 1 and 2i + 2 and its
// parent is at floor((i - 1) / 2). The heap property is that every parent's
// priority is <= its children's, so the smallest priority is always at
// index 0.
//
// Dijkstra uses "lazy deletion": instead of a decrease-key operation it
// pushes a new entry whenever it finds a shorter distance and skips stale
// entries when they are popped. That keeps this heap tiny and easy to test.

interface Entry<T> {
  item: T;
  priority: number;
  /** Insertion counter. Breaks priority ties so pops are deterministic (first in, first out). */
  seq: number;
}

export class MinHeap<T> {
  private entries: Entry<T>[] = [];
  private nextSeq = 0;

  get size(): number {
    return this.entries.length;
  }

  push(item: T, priority: number): void {
    if (Number.isNaN(priority)) throw new RangeError('Heap priority must not be NaN');
    this.entries.push({ item, priority, seq: this.nextSeq++ });
    this.siftUp(this.entries.length - 1);
  }

  peek(): { item: T; priority: number } | undefined {
    const top = this.entries[0];
    return top && { item: top.item, priority: top.priority };
  }

  pop(): { item: T; priority: number } | undefined {
    const top = this.entries[0];
    if (!top) return undefined;
    // Move the last entry to the root, then push it down to restore order.
    const last = this.entries.pop()!;
    if (this.entries.length > 0) {
      this.entries[0] = last;
      this.siftDown(0);
    }
    return { item: top.item, priority: top.priority };
  }

  private less(a: number, b: number): boolean {
    const x = this.entries[a];
    const y = this.entries[b];
    return x.priority < y.priority || (x.priority === y.priority && x.seq < y.seq);
  }

  private swap(a: number, b: number): void {
    const tmp = this.entries[a];
    this.entries[a] = this.entries[b];
    this.entries[b] = tmp;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) return;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.entries.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.less(left, smallest)) smallest = left;
      if (right < n && this.less(right, smallest)) smallest = right;
      if (smallest === i) return;
      this.swap(i, smallest);
      i = smallest;
    }
  }
}
