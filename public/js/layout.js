const FALLBACK_BOTTOM_RESERVE = 300;
const MIN_BOARD_HEIGHT = 220;

function visibleHeight(element) {
  if (!element) return 0;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return 0;
  return element.offsetHeight;
}

export function measureBoardArea(canvas) {
  const wrapper = canvas.parentElement;
  const width = Math.max(
    0,
    wrapper && wrapper.clientWidth > 0
      ? wrapper.clientWidth
      : window.innerWidth - 48,
  );

  let height = Math.max(
    MIN_BOARD_HEIGHT,
    window.innerHeight - FALLBACK_BOTTOM_RESERVE,
  );

  const screen = canvas.closest('#game-screen');
  if (screen && wrapper) {
    const screenRect = screen.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    if (screenRect.height > 0 && width > 0) {
      const columnLayout = window.matchMedia('(max-width: 860px)').matches;
      const screenStyle = window.getComputedStyle(screen);
      const paddingBottom = parseFloat(screenStyle.paddingBottom) || 0;
      const reserve = columnLayout
        ? paddingBottom + 12
        : visibleHeight(screen.querySelector('.dpad')) +
          visibleHeight(screen.querySelector('.hint')) +
          visibleHeight(screen.querySelector('#back-to-lobby-button')) +
          paddingBottom +
          24;
      const wrapperTop = wrapperRect.top + window.scrollY;
      const measured = window.innerHeight - wrapperTop - reserve;

      if (Number.isFinite(measured) && measured > 0) {
        height = Math.max(MIN_BOARD_HEIGHT, measured);
      }
    }
  }

  return { width, height };
}

export function fitTileSize({
  availableWidth,
  availableHeight,
  columns,
  rows,
  minTile = 10,
}) {
  if (!columns || !rows) return minTile;

  const width = Number.isFinite(availableWidth) ? availableWidth : 0;
  const height = Number.isFinite(availableHeight) ? availableHeight : 0;
  const tile = Math.floor(Math.min(width / columns, height / rows));

  return Math.max(minTile, Number.isFinite(tile) ? tile : minTile);
}
