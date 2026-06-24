"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import {
  categoryDisplayItems,
  defaultCategoryDisplayOrder,
  orderCategoryDisplayItems,
  readCategoryDisplayOrder,
  writeCategoryDisplayOrder,
} from "@/lib/category-display-order";

function moveItem(order: string[], id: string, direction: -1 | 1) {
  const currentIndex = order.indexOf(id);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) {
    return order;
  }

  const nextOrder = [...order];
  const [item] = nextOrder.splice(currentIndex, 1);
  nextOrder.splice(nextIndex, 0, item);
  return nextOrder;
}

function moveItemToEdge(order: string[], id: string, edge: "start" | "end") {
  const currentIndex = order.indexOf(id);

  if (currentIndex < 0) {
    return order;
  }

  const nextOrder = [...order];
  const [item] = nextOrder.splice(currentIndex, 1);

  if (edge === "start") {
    nextOrder.unshift(item);
  } else {
    nextOrder.push(item);
  }

  return nextOrder;
}

export function CategoryOrderAdminPanel() {
  const [order, setOrder] = useState(defaultCategoryDisplayOrder);
  const [notice, setNotice] = useState("Порядок сохранен");
  const orderedItems = useMemo(() => orderCategoryDisplayItems(categoryDisplayItems, order), [order]);

  useEffect(() => {
    setOrder(readCategoryDisplayOrder());
  }, []);

  function applyOrder(nextOrder: string[], message = "Порядок сохранен") {
    const savedOrder = writeCategoryDisplayOrder(nextOrder);
    setOrder(savedOrder);
    setNotice(message);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#060b27]">Порядок отображения категорий</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Меняйте последовательность плиток на главной и странице категорий. Изменения применяются сразу в этом браузере.
          </p>
        </div>
        <button
          type="button"
          onClick={() => applyOrder(defaultCategoryDisplayOrder, "Порядок сброшен")}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1]"
        >
          <RotateCcw className="h-4 w-4" />
          Сбросить
        </button>
      </div>

      <div className="mt-4 grid gap-2">
        {orderedItems.map((item, index) => (
          <div key={item.id} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:p-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-500 ring-1 ring-slate-200 sm:h-10 sm:w-10">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 sm:text-base">{item.label}</p>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{item.href}</p>
            </div>
            <div className="col-span-2 grid grid-cols-4 gap-1.5 sm:col-span-1 sm:flex sm:justify-end sm:gap-2">
              <button
                type="button"
                onClick={() => applyOrder(moveItemToEdge(order, item.id, "start"))}
                disabled={index === 0}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] disabled:cursor-not-allowed disabled:opacity-40"
                title="В начало"
              >
                В начало
              </button>
              <button
                type="button"
                onClick={() => applyOrder(moveItem(order, item.id, -1))}
                disabled={index === 0}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] disabled:cursor-not-allowed disabled:opacity-40"
                title="Выше"
              >
                <ArrowUp className="h-3.5 w-3.5" />
                Выше
              </button>
              <button
                type="button"
                onClick={() => applyOrder(moveItem(order, item.id, 1))}
                disabled={index === orderedItems.length - 1}
                className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] disabled:cursor-not-allowed disabled:opacity-40"
                title="Ниже"
              >
                <ArrowDown className="h-3.5 w-3.5" />
                Ниже
              </button>
              <button
                type="button"
                onClick={() => applyOrder(moveItemToEdge(order, item.id, "end"))}
                disabled={index === orderedItems.length - 1}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0875d1] disabled:cursor-not-allowed disabled:opacity-40"
                title="В конец"
              >
                В конец
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm font-bold text-[#0a8f32]" aria-live="polite">
        {notice}
      </p>
    </section>
  );
}
