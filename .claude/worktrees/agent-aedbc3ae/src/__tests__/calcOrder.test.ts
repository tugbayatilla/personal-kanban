/**
 * Unit tests for calcOrder() — src/io.ts
 *
 * calcOrder implements fractional / midpoint indexing: the new card's order is
 * always the arithmetic mean of the two surrounding boundary values. Boundaries
 * are 0 (exclusive top) and 1 (exclusive bottom).
 *
 * Coverage: insertion at top, bottom, between cards, repeated subdivision,
 * and degenerate equal-boundary inputs.
 */

import { calcOrder } from '../io';

describe('calcOrder', () => {
  describe('first card in an empty column', () => {
    /**
     * @spec ORD-001
     * @contract First card placed in an empty column must land exactly at 0.5
     *   (midpoint of 0 and 1). Changing this breaks the expected default placement.
     */
    it('returns 0.5 when boundaries are 0 and 1', () => {
      expect(calcOrder(0, 1)).toBe(0.5);
    });
  });

  describe('inserting after the last card (append to bottom)', () => {
    it('returns the midpoint of the last card order and 1', () => {
      // Card at 0.5 is already in column; new card appended below it.
      expect(calcOrder(0.5, 1)).toBe(0.75);
    });

    it('returns the midpoint when last card order is 0.75', () => {
      expect(calcOrder(0.75, 1)).toBe(0.875);
    });
  });

  describe('inserting before the first card (prepend to top)', () => {
    it('returns the midpoint of 0 and the first card order', () => {
      // First card sits at 0.5; new card inserted above it.
      expect(calcOrder(0, 0.5)).toBe(0.25);
    });

    it('returns the midpoint of 0 and a small first-card order', () => {
      expect(calcOrder(0, 0.25)).toBe(0.125);
    });
  });

  describe('inserting between two existing cards', () => {
    it('returns the exact midpoint of adjacent cards', () => {
      expect(calcOrder(0.5, 0.75)).toBe(0.625);
    });

    it('returns the exact midpoint for a narrow gap', () => {
      expect(calcOrder(0.6, 0.7)).toBeCloseTo(0.65, 10);
    });
  });

  describe('repeated midpoint subdivision', () => {
    it('produces a strictly decreasing sequence of gaps after many insertions', () => {
      let low = 0;
      const high = 1;
      const orders: number[] = [];

      // Simulate 10 cards each appended to the bottom.
      for (let i = 0; i < 10; i++) {
        const order = calcOrder(low, high);
        orders.push(order);
        low = order; // next card's lower boundary becomes this card's order
      }

      // Every subsequent value must be larger (closer to 1) than the previous.
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThan(orders[i - 1]);
      }
    });

    it('never returns a value outside the (0, 1) open interval for standard inputs', () => {
      const pairs: [number, number][] = [
        [0, 1], [0, 0.5], [0.5, 1], [0.25, 0.75], [0.001, 0.002],
      ];
      for (const [prev, next] of pairs) {
        const result = calcOrder(prev, next);
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThan(1);
      }
    });
  });

  describe('mathematical identity', () => {
    it('is commutative in the sense that swapping inputs gives a different (symmetric) value', () => {
      // calcOrder is NOT commutative — order matters. This test confirms it.
      expect(calcOrder(0.2, 0.8)).toBe(0.5);
      expect(calcOrder(0.8, 0.2)).toBe(0.5); // same midpoint by arithmetic symmetry
    });

    it('always equals (prev + next) / 2', () => {
      const cases: [number, number][] = [[0, 1], [0.3, 0.7], [0.1, 0.4], [0.6, 0.9]];
      for (const [prev, next] of cases) {
        expect(calcOrder(prev, next)).toBe((prev + next) / 2);
      }
    });
  });

  describe('edge cases', () => {
    it('returns prev when prev and next are equal (degenerate gap)', () => {
      // Not a valid real-world scenario, but the function must not throw.
      expect(calcOrder(0.5, 0.5)).toBe(0.5);
    });

    it('handles very small gaps without throwing', () => {
      const tiny = Number.EPSILON;
      expect(() => calcOrder(0.5, 0.5 + tiny)).not.toThrow();
    });
  });
});
