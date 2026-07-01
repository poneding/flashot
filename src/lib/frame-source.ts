import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

const ASSET_LOCALHOST_PREFIX = "asset://localhost/";

function decodeAssetPath(path: string) {
  if (!path.includes("%")) return path;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function frameSourceFromUrl(url: string) {
  if (!url.startsWith(ASSET_LOCALHOST_PREFIX)) return url;

  // Backend sessions emit asset://localhost/<absolute path>. convertFileSrc
  // encodes that path into a source WebView can load reliably.
  try {
    return convertFileSrc(decodeAssetPath(url.slice(ASSET_LOCALHOST_PREFIX.length)));
  } catch {
    return url;
  }
}

function canCreateReleasableFrameSource() {
  return (
    typeof fetch === "function" &&
    typeof AbortController !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof URL.revokeObjectURL === "function"
  );
}

export function useReleasableFrameSource(url: string | null): string | null {
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setSource(null);
      return;
    }

    const fileSource = frameSourceFromUrl(url);
    if (!canCreateReleasableFrameSource()) {
      setSource(fileSource);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();

    setSource(null);
    fetch(fileSource, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`failed to load frame: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch((error) => {
        if (cancelled || error?.name === "AbortError") return;
        // If a platform does not allow fetch() for the asset protocol, keep
        // the existing direct image path. This preserves capture rather than
        // turning cache mitigation into a hard dependency.
        setSource(fileSource);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return source;
}

export function loadReleasableFrameImage(
  url: string,
  {
    crossOrigin = "anonymous",
    onLoad,
    onError,
  }: {
    crossOrigin?: string;
    onLoad: (image: HTMLImageElement) => void;
    onError?: (error: unknown) => void;
  },
): () => void {
  const fileSource = frameSourceFromUrl(url);
  const image = new Image();
  image.crossOrigin = crossOrigin;

  let cancelled = false;
  let objectUrl: string | null = null;
  let controller: AbortController | null = null;

  const revokeObjectUrl = () => {
    if (!objectUrl) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  };

  const loadSource = (source: string) => {
    if (cancelled) return;
    image.src = source;
  };

  image.onload = () => {
    if (cancelled) return;
    onLoad(image);
  };
  image.onerror = (error) => {
    if (cancelled) return;
    onError?.(error);
  };

  if (canCreateReleasableFrameSource()) {
    controller = new AbortController();
    fetch(fileSource, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`failed to load frame: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        loadSource(objectUrl);
      })
      .catch((error) => {
        if (cancelled || error?.name === "AbortError") return;
        loadSource(fileSource);
      });
  } else {
    loadSource(fileSource);
  }

  return () => {
    cancelled = true;
    controller?.abort();
    image.onload = null;
    image.onerror = null;
    image.src = "";
    revokeObjectUrl();
  };
}
