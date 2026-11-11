// Keep navigation scroll resets independent of the global smooth-scroll CSS.
// This is especially important on iOS Safari when a QR page first renders
// a loading placeholder and later replaces it with the full manual.
export function resetPageScroll(win,doc){
  const root=doc.documentElement;
  const previous=root.style.scrollBehavior;
  root.style.scrollBehavior='auto';
  try {
    win.scrollTo({top:0,left:0,behavior:'instant'});
    if(doc.scrollingElement)doc.scrollingElement.scrollTop=0;
    if(doc.body)doc.body.scrollTop=0;
  } finally {
    root.style.scrollBehavior=previous;
  }
}
