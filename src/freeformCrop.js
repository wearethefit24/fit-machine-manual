// Free-form crop rectangle is normalized to the visible source image.
// This keeps the selection independent of the phone screen size.
export const INITIAL_FREEFORM_CROP = Object.freeze({x:0.05,y:0.05,w:0.9,h:0.9});
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));

export function containedImageBounds(imageWidth,imageHeight,stageWidth=1200,stageHeight=900) {
  if (!(imageWidth>0 && imageHeight>0 && stageWidth>0 && stageHeight>0)) return null;
  const scale=Math.min(stageWidth/imageWidth,stageHeight/imageHeight);
  const w=imageWidth*scale,h=imageHeight*scale;
  return {x:(stageWidth-w)/2,y:(stageHeight-h)/2,w,h};
}

export function adjustFreeformCrop(rect,handle,dx,dy,minSize=0.1) {
  if(!rect || !Number.isFinite(dx) || !Number.isFinite(dy)) return rect;
  const left=rect.x,top=rect.y,right=rect.x+rect.w,bottom=rect.y+rect.h;
  if(handle==='move') return {
    x:clamp(left+dx,0,1-rect.w),
    y:clamp(top+dy,0,1-rect.h),
    w:rect.w,h:rect.h
  };
  if(!['n','ne','e','se','s','sw','w','nw'].includes(handle)) return rect;
  const l=handle.includes('w')?clamp(left+dx,0,right-minSize):left;
  const r=handle.includes('e')?clamp(right+dx,l+minSize,1):right;
  const t=handle.includes('n')?clamp(top+dy,0,bottom-minSize):top;
  const b=handle.includes('s')?clamp(bottom+dy,t+minSize,1):bottom;
  return {x:l,y:t,w:r-l,h:b-t};
}

export function freeformOutputSize(imageWidth,imageHeight,selection,maxSide=1200) {
  if(!selection || !(imageWidth>0 && imageHeight>0)) return null;
  const w=imageWidth*selection.w,h=imageHeight*selection.h;
  if(!(w>0 && h>0))return null;
  const factor=Math.min(1,maxSide/Math.max(w,h));
  return {width:Math.max(1,Math.round(w*factor)),height:Math.max(1,Math.round(h*factor))};
}
