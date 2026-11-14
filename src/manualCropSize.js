// Crop manual photos to a predictable maximum output size without
// upscaling extreme ratios into multi-megapixel JPEGs.
const MAX_SIDE = 1200;
export function manualCropSize(mode, customWidth = 16, customHeight = 9) {
  let x, y;
  if (mode === '4:3') [x, y] = [4, 3];
  else if (mode === '1:1') [x, y] = [1, 1];
  else if (mode === 'custom') {
    x = Number(customWidth);
    y = Number(customHeight);
    if (!Number.isInteger(x) || !Number.isInteger(y) ||
        x < 1 || y < 1 || x > 99 || y > 99 ||
        String(customWidth).trim() === '' || String(customHeight).trim() === '') return null;
  } else return null;
  if (mode === '4:3') return {width:1200,height:900};
  if (mode === '1:1') return {width:900,height:900};
  return x >= y
    ? {width:MAX_SIDE,height:Math.max(1,Math.round(MAX_SIDE*y/x))}
    : {width:Math.max(1,Math.round(MAX_SIDE*x/y)),height:MAX_SIDE};
}
