export function createUploadId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function triggerBrowserDownload(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
