// TEST ONLY: never configured in the shipping Vite build. Real store/modal,
// synthetic source. Does NOT prove Capacitor/iOS keyboard plugin integration.
export function syntheticKeyboardPlugin() {
 return {name:'golfme-synthetic-keyboard',enforce:'pre',transform(source,id){
  if(!id.split('?')[0].endsWith('/src/lib/useKeyboardHeight.ts')) return;
  const original='const keyboardStore = createKeyboardStore(Capacitor.isNativePlatform() ? capacitorKeyboardSource : null, () => performance.now());';
  if(!source.includes(original)) throw new Error('Keyboard fixture source changed; inspect before updating');
  return source.replace(original, `const keyboardStore = createKeyboardStore(() => {}, () => performance.now());
window.addEventListener('golfme:synthetic-keyboard', (event) => {
 const height = Number((event as CustomEvent).detail?.height) || 0;
 document.body.style.height = height > 0 ? (window.innerHeight-height)+'px' : '';
 if(height > 0) { keyboardStore.handlers.willShow(height); keyboardStore.handlers.didShow(height); }
 else { keyboardStore.handlers.willHide(); keyboardStore.handlers.didHide(); }
});`);
 }};
}
