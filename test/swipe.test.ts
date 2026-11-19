import { describe, expect, it } from 'vitest';
import { swipeDirection } from '../public/js/swipe.js';

describe('swipeDirection', () => {
  it('игнорирует короткие жесты', () => {
    expect(swipeDirection(5, 5)).toBe(null);
    expect(swipeDirection(10, -10, 30)).toBe(null);
  });

  it('определяет горизонтальные свайпы', () => {
    expect(swipeDirection(40, 5)).toBe('right');
    expect(swipeDirection(-40, -5)).toBe('left');
  });

  it('определяет вертикальные свайпы', () => {
    expect(swipeDirection(5, 40)).toBe('down');
    expect(swipeDirection(-5, -40)).toBe('up');
  });

  it('при равенстве осей считает жест горизонтальным', () => {
    expect(swipeDirection(30, 30)).toBe('right');
    expect(swipeDirection(-30, 30)).toBe('left');
  });
});
