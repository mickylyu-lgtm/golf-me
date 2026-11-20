const SWIPE_ADVANCE_PX = 15;

/** Home-only touch paging. Native mouse/trackpad/keyboard scrolling keeps CSS snapping. */
export function attachRoundStripSnap(strip: HTMLElement) {
  let gesture: { x:number; y:number; start:number; index:number; points:number[]; axis:'pending'|'x'|'y'; dx:number } | null = null;
  let suppressClickUntil = 0;
  let dragFrame: number | null = null;
  let settleFrame: number | null = null;
  let settleTarget: number | null = null;
  const stopDrag = () => {
    if (dragFrame !== null) cancelAnimationFrame(dragFrame);
    dragFrame = null;
  };
  const stopSettle = () => {
    if (settleFrame !== null) cancelAnimationFrame(settleFrame);
    settleFrame = null;
    settleTarget = null;
  };
  const originalSnap = strip.style.scrollSnapType;
  const originalTouchAction = strip.style.touchAction;
  strip.style.touchAction = 'pan-y pinch-zoom';
  const points = () => {
    const padding = parseFloat(getComputedStyle(strip).scrollPaddingLeft) || 0;
    const left = strip.getBoundingClientRect().left;
    const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
    return [...strip.children].map(child => Math.max(0, Math.min(max, child.getBoundingClientRect().left - left + strip.scrollLeft - padding)));
  };
  const dragTo = (g: NonNullable<typeof gesture>) => {
    // Track the finger without allowing a long fling to skip multiple cards.
    // Fast repeated swipes can leave the visible offset behind the logical
    // card. Include that offset so the first drag frame never jumps ahead.
    const lo = Math.min(g.start, g.points[Math.max(0,g.index-1)]);
    const hi = Math.max(g.start, g.points[Math.min(g.points.length-1,g.index+1)]);
    strip.scrollLeft = Math.max(lo,Math.min(hi,g.start-g.dx));
  };
  const settle = (target: number) => {
    stopSettle();
    const from = strip.scrollLeft;
    const arrive = () => {
      settleFrame = null;
      settleTarget = null;
      strip.scrollTo({left:target, behavior:'instant'});
      strip.style.scrollSnapType = originalSnap;
    };
    if (Math.abs(target-from) < 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) { arrive(); return; }
    // Use one animation owner through release. Re-enabling mandatory native
    // snap before reaching the target lets WebKit re-snap mid-settle.
    const duration = Math.min(300, Math.max(120, Math.abs(target-from)*0.75));
    const startTime = performance.now();
    const frame = (time: number) => {
      const progress = Math.min(1, Math.max(0,(time-startTime)/duration));
      if (progress === 1) { arrive(); return; }
      const eased = 1 - (1-progress)**3;
      strip.scrollLeft = from + (target-from)*eased;
      settleFrame = requestAnimationFrame(frame);
    };
    settleTarget = target;
    settleFrame = requestAnimationFrame(frame);
  };
  const claim = (g: NonNullable<typeof gesture>) => {
    // A second swipe takes control at the current visual offset, not an
    // earlier recorded position from before the previous settle advanced.
    if (settleFrame !== null) { stopSettle(); g.start = strip.scrollLeft; }
    strip.style.scrollSnapType = 'none';
    g.axis = 'x';
  };
  const finish = (cancelled: boolean) => {
    const g = gesture; gesture = null;
    if (!g || g.axis !== 'x') return;
    stopDrag();
    const step = !cancelled && Math.abs(g.dx) >= SWIPE_ADVANCE_PX ? (g.dx < 0 ? 1 : -1) : 0;
    const index = Math.max(0, Math.min(g.points.length - 1, g.index + step));
    settle(g.points[index]);
    suppressClickUntil = Date.now() + 500;
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) { finish(true); return; }
    // A new deliberate tap is not a ghost click from the previous swipe.
    suppressClickUntil = 0;
    const p = points(); if (!p.length) return;
    const anchor = settleTarget ?? strip.scrollLeft;
    const index = p.reduce((best, value, i) => Math.abs(value-anchor)<Math.abs(p[best]-anchor)?i:best,0);
    const touch = event.touches[0];
    gesture = {x:touch.clientX,y:touch.clientY,start:strip.scrollLeft,index,points:p,axis:'pending',dx:0};
  };
  const move = (event: TouchEvent) => {
    if (event.touches.length !== 1) { finish(true); return; }
    const g = gesture; if (!g) return;
    const dx = event.touches[0].clientX-g.x, dy = event.touches[0].clientY-g.y;
    if (g.axis === 'pending' && Math.max(Math.abs(dx),Math.abs(dy)) >= 8) {
      if (Math.abs(dx) > Math.abs(dy)*1.2 && event.cancelable) claim(g);
      else g.axis = 'y';
    }
    if (g.axis !== 'x') return;
    if (!event.cancelable) { finish(true); return; }
    event.preventDefault(); g.dx = dx;
    // Coalesce multiple touch events into one scroll write per frame.
    if (dragFrame === null) dragFrame = requestAnimationFrame(() => {
      dragFrame = null;
      if (gesture === g) dragTo(g);
    });
  };
  const end = (event: TouchEvent) => {
    // Browsers may coalesce every move below their native touch slop. Read the
    // final coordinate too, so a small drag cannot become an accidental tap.
    const g = gesture, touch = event.changedTouches?.[0];
    if (g && touch && g.axis !== 'y') {
      const dx = touch.clientX-g.x, dy = touch.clientY-g.y;
      if (g.axis === 'x' || (Math.abs(dx)>=8 && Math.abs(dx)>Math.abs(dy)*1.2)) {
        if (g.axis !== 'x') claim(g);
        g.dx=dx;
      }
    }
    finish(false);
  };
  const cancel = () => finish(true);
  const click = (event: MouseEvent) => { if (event.detail !== 0 && Date.now()<suppressClickUntil) {event.preventDefault();event.stopPropagation();} };
  strip.addEventListener('touchstart',start,{passive:true});
  strip.addEventListener('touchmove',move,{passive:false});
  strip.addEventListener('touchend',end);
  strip.addEventListener('touchcancel',cancel);
  strip.addEventListener('click',click,true);
  return () => {
    gesture=null; stopDrag(); stopSettle(); strip.style.scrollSnapType=originalSnap; strip.style.touchAction=originalTouchAction;
    strip.removeEventListener('touchstart',start); strip.removeEventListener('touchmove',move);
    strip.removeEventListener('touchend',end); strip.removeEventListener('touchcancel',cancel); strip.removeEventListener('click',click,true);
  };
}
