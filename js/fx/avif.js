// AVIF: the same pictures in about half the bytes. Browsers that cannot show it (iOS before 16,
// older desktops) keep the WebP files, which stay beside the AVIF ones. The probe is a 2x2 AVIF with
// transparency, so a browser that passes it can also show the see-through stacker frames.
const PROBE = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAGGbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAG/AAAAKAACAAAAAQAAAa4AAAARAAAAQmlpbmYAAAAAAAIAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAABppbmZlAgAAAAACAABhdjAxQWxwaGEAAAAAGmlyZWYAAAAAAAAADmF1eGwAAgABAAEAAADDaXBycAAAAJ1pcGNvAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAAA5waXhpAAAAAAEIAAAADGF2MUOBABwAAAAAOGF1eEMAAAAAdXJuOm1wZWc6bXBlZ0I6Y2ljcDpzeXN0ZW1zOmF1eGlsaWFyeTphbHBoYQAAAAAeaXBtYQAAAAAAAAACAAEEAQKDBAACBAEFhgcAAABBbWRhdBIACgQYADYVMgcYACihABCgEgAKCBgANogIaDQgMhoZR4eGIYeeeeaAAACQQMkcYUsrTY9RRU6koA==';

export const avifOK = new Promise((res) => {
  const im = new Image();
  im.onload = () => res(im.width === 2);
  im.onerror = () => res(false);
  im.src = PROBE;
  setTimeout(() => res(false), 1500);
});

// photos that have an AVIF copy (the rest gained nothing from it and stay WebP only)
const PHOTOS = new Set(['Electronics', 'beauty-and-cosmetics', 'consignment', 'container-loading-and-unloading', 'home-and-office-furniture', 'mission', 'mobile-accessories', 'objective-new-2', 'packages-delivered-1', 'sports-and-outdoor', 'toys-and-games', 'vision-new', 'word-map']);

// switch every such photo on the page to its AVIF copy (photos are lazy: none has started loading yet)
export function avifPhotos(root = document) {
  avifOK.then((ok) => {
    if (!ok) return;
    root.querySelectorAll('img[src*="photos/"][src$=".webp"]').forEach((img) => {
      const src = img.getAttribute('src'), m = src.match(/photos\/([^/]+)\.webp$/);
      if (m && PHOTOS.has(m[1])) img.src = src.replace(/\.webp$/, '.avif');
    });
  });
}
