export const SWIPE_THRESHOLD = 24;

export function swipeDirection(dx, dy, threshold = SWIPE_THRESHOLD) {
  if (Math.hypot(dx, dy) < threshold) return null;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'down' : 'up';
}

export function attachSwipeControls(element, onSwipe, options = {}) {
  const threshold = options.threshold ?? SWIPE_THRESHOLD;
  let start = null;
  let handled = false;

  function onTouchStart(event) {
    if (event.touches.length !== 1) {
      start = null;
      return;
    }

    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
    handled = false;
  }

  function onTouchMove(event) {
    if (!start) return;

    if (event.touches.length !== 1) {
      start = null;
      return;
    }

    if (handled) {
      event.preventDefault();
      return;
    }

    const touch = event.touches[0];
    const direction = swipeDirection(
      touch.clientX - start.x,
      touch.clientY - start.y,
      threshold,
    );
    if (!direction) return;

    event.preventDefault();
    handled = true;
    onSwipe(direction);
  }

  function onTouchEnd() {
    start = null;
    handled = false;
  }

  element.addEventListener('touchstart', onTouchStart, { passive: true });
  element.addEventListener('touchmove', onTouchMove, { passive: false });
  element.addEventListener('touchend', onTouchEnd);
  element.addEventListener('touchcancel', onTouchEnd);

  return () => {
    element.removeEventListener('touchstart', onTouchStart);
    element.removeEventListener('touchmove', onTouchMove);
    element.removeEventListener('touchend', onTouchEnd);
    element.removeEventListener('touchcancel', onTouchEnd);
  };
}
