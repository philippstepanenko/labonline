const FALLBACK_BOTTOM_RESERVE = 300;
const MIN_BOARD_HEIGHT = 220;
const MIN_MOBILE_BOARD_HEIGHT = 120;

function visibleHeight(element) {
  if (!element) return 0;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return 0;
  return element.offsetHeight;
}

function rowGap(element, fallback = 0) {
  if (!element) return fallback;
  const style = window.getComputedStyle(element);
  const gap = parseFloat(style.rowGap);
  if (Number.isFinite(gap)) return gap;
  const shorthand = parseFloat(style.gap);
  return Number.isFinite(shorthand) ? shorthand : fallback;
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
      const backButton = screen.querySelector('#back-to-lobby-button');
      const backHeight = visibleHeight(backButton);

      let reserve;
      if (columnLayout) {
        const sidebarHeight = visibleHeight(screen.querySelector('.sidebar'));
        const boardGap = rowGap(wrapper.parentElement, 18);
        const screenGap = rowGap(screen, 0);
        const backStyle = backButton ? window.getComputedStyle(backButton) : null;
        const backMargin = backStyle
          ? (parseFloat(backStyle.marginTop) || 0) +
            (parseFloat(backStyle.marginBottom) || 0)
          : 0;
        const backReserve =
          backHeight > 0 ? backHeight + backMargin + screenGap : 0;
        reserve = paddingBottom + sidebarHeight + boardGap + backReserve;
      } else {
        reserve = backHeight + paddingBottom + 24;
      }

      const wrapperTop = wrapperRect.top + window.scrollY;
      const measured = window.innerHeight - wrapperTop - reserve;

      if (Number.isFinite(measured) && measured > 0) {
        const minHeight = columnLayout
          ? MIN_MOBILE_BOARD_HEIGHT
          : MIN_BOARD_HEIGHT;
        height = Math.max(minHeight, measured);
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
