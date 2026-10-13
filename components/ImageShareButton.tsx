"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Download, LoaderCircle, Share2, X } from "lucide-react";
import { canShareImages, shareImages } from "@/lib/image-sharing";

type Props = { children: ReactNode; title: string; filename: string; label?: string; imageAlt?: string };

export function ImageShareButton({ children, title, filename, label = "Share", imageAlt = title }: Props) {
  const exportRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const titleId = useId();
  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ file: File; url: string; nativeShare: boolean } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!preview) return;
    dialogRef.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      URL.revokeObjectURL(preview.url);
      document.body.style.overflow = previousOverflow;
    };
  }, [preview]);

  async function generate() {
    if (busyRef.current || !exportRef.current) return;
    busyRef.current = true;
    setGenerating(true);
    setError("");
    try {
      await document.fonts.ready;
      const { toBlob } = await import("html-to-image");
      const source = exportRef.current.firstElementChild as HTMLElement;
      const blob = await toBlob(source, { backgroundColor: "#ffffff", pixelRatio: 2, skipFonts: true });
      if (!blob) throw new Error("Image generation returned no image.");
      const file = new File([blob], filename, { type: "image/png" });
      if (!mountedRef.current) return;
      setPreview({ file, url: URL.createObjectURL(file), nativeShare: canShareImages([file]) });
    } catch {
      setError("Could not generate the image. Please try again.");
    } finally {
      busyRef.current = false;
      setGenerating(false);
    }
  }

  async function share() {
    if (!preview || sharing) return;
    setSharing(true);
    setError("");
    try {
      await shareImages([preview.file], title);
    } catch {
      setError("Sharing is unavailable. You can download the image instead.");
    } finally {
      setSharing(false);
    }
  }

  function close() {
    if (sharing) return;
    dialogRef.current?.close();
    setPreview(null);
    setError("");
  }

  return (
    <>
      <div className="flex max-w-full flex-col items-end gap-2">
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={generate} disabled={generating} aria-busy={generating}>
          {generating ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Share2 aria-hidden="true" className="h-4 w-4" />}
          {generating ? "Generating..." : label}
        </button>
        {!preview && error ? <p role="alert" className="max-w-64 text-sm text-red-700">{error}</p> : null}
      </div>
      {/* Keep the complete export mounted outside the viewport, never display:none. */}
      <div ref={exportRef} aria-hidden="true" style={{ position: "fixed", left: "-10000px", top: 0, pointerEvents: "none" }}>
        {children}
      </div>
      <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-hidden rounded-lg border border-line bg-white p-0 text-ink backdrop:bg-black/50">
        {preview ? (
          <div className="flex max-h-[90dvh] flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line p-4">
              <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
              <button type="button" onClick={close} disabled={sharing} className="rounded-md p-2 hover:bg-slate-100" aria-label="Close preview" title="Close preview"><X aria-hidden="true" className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 overflow-auto bg-slate-100 p-3 sm:p-5">
              {/* A blob preview is deliberately local and does not use Next image optimization. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt={imageAlt} className="h-auto w-full" />
            </div>
            <div className="shrink-0 border-t border-line p-4">
              {error ? <p role="alert" className="mb-3 text-sm text-red-700">{error}</p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <a className="btn-secondary inline-flex items-center gap-2" href={preview.url} download={preview.file.name}><Download aria-hidden="true" className="h-4 w-4" />Download image</a>
                {preview.nativeShare ? <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={sharing} onClick={share}>{sharing ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Share2 aria-hidden="true" className="h-4 w-4" />}Share</button> : null}
              </div>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

