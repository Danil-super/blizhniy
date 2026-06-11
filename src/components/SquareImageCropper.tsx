"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Move, X } from "lucide-react";

type ImageSize = {
  height: number;
  width: number;
};

type CropDraft = {
  offsetX: number;
  offsetY: number;
  zoom: number;
};

type SquareImageCropperProps = {
  alt: string;
  description?: string;
  onApply: (dataUrl: string) => void | Promise<void>;
  onCancel: () => void;
  outputSize?: number;
  src: string;
  title?: string;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось подготовить изображение."));
    image.src = src;
  });
}

function getCropTransform(draft: CropDraft, imageSize: ImageSize, stageSize: number) {
  const baseScale = Math.max(stageSize / imageSize.width, stageSize / imageSize.height);
  const scale = baseScale * draft.zoom;
  const width = imageSize.width * scale;
  const height = imageSize.height * scale;
  const maxOffsetX = Math.max(0, (width - stageSize) / 2);
  const maxOffsetY = Math.max(0, (height - stageSize) / 2);
  const offsetX = clampNumber(draft.offsetX, -maxOffsetX, maxOffsetX);
  const offsetY = clampNumber(draft.offsetY, -maxOffsetY, maxOffsetY);

  return {
    height,
    offsetX,
    offsetY,
    scale,
    width,
  };
}

async function cropSquareImage(src: string, draft: CropDraft, imageSize: ImageSize, stageSize: number, minimumOutputSize: number) {
  const image = await loadImage(src);
  const transform = getCropTransform(draft, imageSize, stageSize);
  const sourceX = (transform.width / 2 - stageSize / 2 - transform.offsetX) / transform.scale;
  const sourceY = (transform.height / 2 - stageSize / 2 - transform.offsetY) / transform.scale;
  const sourceSize = stageSize / transform.scale;
  const outputSize = Math.max(minimumOutputSize, Math.round(sourceSize));
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;

  const context = canvas.getContext("2d");

  if (!context) {
    return src;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, outputSize, outputSize);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
  return canvas.toDataURL("image/png");
}

export function SquareImageCropper({ alt, description = "Перетащите фото внутри квадрата и настройте масштаб.", onApply, onCancel, outputSize = 2400, src, title = "Выберите кадр" }: SquareImageCropperProps) {
  const [draft, setDraft] = useState<CropDraft>({ offsetX: 0, offsetY: 0, zoom: 1 });
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [stageSize, setStageSize] = useState(320);
  const [dragStart, setDragStart] = useState<{ offsetX: number; offsetY: number; pointerId: number; startX: number; startY: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    loadImage(src)
      .then((image) => {
        if (active) {
          setImageSize({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
        }
      })
      .catch(() => {
        if (active) {
          setError("Не удалось открыть изображение.");
        }
      });

    return () => {
      active = false;
    };
  }, [src]);

  useEffect(() => {
    if (!stageRef.current) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setStageSize(Math.round(entry.contentRect.width));
    });

    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

  function updateDraft(patch: Partial<CropDraft>) {
    if (!imageSize) {
      return;
    }

    const nextDraft = { ...draft, ...patch };
    const transform = getCropTransform(nextDraft, imageSize, stageSize);
    setDraft({ ...nextDraft, offsetX: transform.offsetX, offsetY: transform.offsetY });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({
      offsetX: draft.offsetX,
      offsetY: draft.offsetY,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) {
      return;
    }

    updateDraft({
      offsetX: dragStart.offsetX + event.clientX - dragStart.startX,
      offsetY: dragStart.offsetY + event.clientY - dragStart.startY,
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStart?.pointerId === event.pointerId) {
      setDragStart(null);
    }
  }

  async function applyCrop() {
    if (!imageSize) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await onApply(await cropSquareImage(src, draft, imageSize, stageSize, outputSize));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось применить кадр.");
    } finally {
      setSaving(false);
    }
  }

  const transform = imageSize ? getCropTransform(draft, imageSize, stageSize) : null;

  return (
    <div className="fixed inset-0 z-[220] grid place-items-center bg-slate-950/60 p-3 sm:p-4" role="dialog" aria-modal="true">
      <section className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-[#060b27] sm:text-xl">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
          </div>
          <button type="button" onClick={onCancel} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:text-rose-600" aria-label="Закрыть редактор фото">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          <div className="grid justify-items-center">
            <div
              ref={stageRef}
              className="relative aspect-square w-full max-w-80 touch-none select-none overflow-hidden rounded-xl bg-slate-950"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {transform ? (
                <img
                  src={src}
                  alt={alt}
                  draggable={false}
                  className="absolute max-w-none select-none"
                  style={{
                    height: `${transform.height}px`,
                    left: `${stageSize / 2 + transform.offsetX - transform.width / 2}px`,
                    top: `${stageSize / 2 + transform.offsetY - transform.height / 2}px`,
                    width: `${transform.width}px`,
                  }}
                />
              ) : null}
              <div className="pointer-events-none absolute inset-0 rounded-xl border-2 border-white shadow-[0_0_0_999px_rgba(2,6,23,0.42)]" />
              <div className="pointer-events-none absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950/60 px-3 py-1 text-xs font-bold text-white">
                <Move className="h-3.5 w-3.5" />
                Перетащите фото
              </div>
            </div>
          </div>

          <label className="mt-5 grid gap-2 text-sm font-bold text-slate-700">
            Масштаб
            <input type="range" min="1" max="3" step="0.01" value={draft.zoom} onChange={(event) => updateDraft({ zoom: clampNumber(Number(event.target.value), 1, 3) })} className="accent-[#0875d1]" />
          </label>

          {error ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={applyCrop} disabled={saving || !transform} className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0875d1] px-4 text-sm font-bold text-white transition hover:bg-[#0664b3] disabled:cursor-not-allowed disabled:bg-slate-300">
              {saving ? "Применяем..." : "Применить"}
            </button>
            <button type="button" onClick={() => updateDraft({ offsetX: 0, offsetY: 0, zoom: 1 })} className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:text-[#0875d1]">
              Сбросить
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
