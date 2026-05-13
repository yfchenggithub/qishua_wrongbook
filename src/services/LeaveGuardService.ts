let hasUnsavedPhotosInAddScreen = false;

export function setAddScreenHasUnsavedPhotos(hasUnsaved: boolean) {
  hasUnsavedPhotosInAddScreen = hasUnsaved;
}

export function getAddScreenHasUnsavedPhotos(): boolean {
  return hasUnsavedPhotosInAddScreen;
}
