import React, { useMemo, useState } from "react";
import { BedDouble, LogOut, CheckCircle2, Wrench, Layers } from "lucide-react";
import type {
  DashboardCategory,
  DashboardReservation,
  DashboardRoom,
} from "./DashboardModule";

type OccupancySummaryKey = "INHOUSE" | "DUE_OUT" | "AVAILABLE" | "OOO_CTS";

interface RoomStatusSummaryWidgetProps {
  rooms: DashboardRoom[];
  reservations: DashboardReservation[];
  categories: DashboardCategory[];
  systemToday: string;
}

interface StatusGroupSummary {
  key: OccupancySummaryKey;
  label: string;
  subLabel: string;
  count: number;
  pct: number;
  barColor: string;
  cardBg: string;
  cardBorder: string;
  badgeText: string;
  dotColor: string;
  byCategory: {
    categoryId: string;
    categoryName: string;
    count: number;
    roomNumbers: string[];
  }[];
}

export default function RoomStatusSummaryWidget({
  rooms,
  reservations,
  categories,
  systemToday,
}: RoomStatusSummaryWidgetProps) {
  const [hoveredKey, setHoveredKey] = useState<OccupancySummaryKey | null>(null);

  const { groups, totalRooms } = useMemo(() => {
    const total = rooms.length;

    const buckets: Record<OccupancySummaryKey, DashboardRoom[]> = {
      INHOUSE: [],
      DUE_OUT: [],
      AVAILABLE: [],
      OOO_CTS: [],
    };

    const activeByRoom = new Map<string, DashboardReservation>();
    reservations.forEach((r) => {
      if (r.lifecycle === "INHOUSE" && r.roomNumber) {
        activeByRoom.set(r.roomNumber, r);
      }
    });

    rooms.forEach((room) => {
      if (room.physicalStatus === "OUT_OF_ORDER" || room.physicalStatus === "CLOSED_TO_SALES") {
        buckets.OOO_CTS.push(room);
        return;
      }
      const activeGuest = activeByRoom.get(room.roomNumber);
      if (activeGuest) {
        if (activeGuest.checkOut === systemToday) {
          buckets.DUE_OUT.push(room);
        } else {
          buckets.INHOUSE.push(room);
        }
        return;
      }
      buckets.AVAILABLE.push(room);
    });

    const buildCategoryBreakdown = (list: DashboardRoom[]) =>
      categories
        .map((cat) => {
          const matching = list.filter((rm) => rm.categoryId === cat.id);
          return {
            categoryId: cat.id,
            categoryName: cat.name,
            count: matching.length,
            roomNumbers: matching.map((rm) => rm.roomNumber),
          };
        })
        .sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.categoryName.localeCompare(b.categoryName, "tr-TR");
        });

    const defs: Omit<StatusGroupSummary, "count" | "pct" | "byCategory">[] = [
      {
        key: "INHOUSE",
        label: "Inhouse",
        subLabel: "Konaklayan",
        barColor: "bg-sky-600",
        cardBg: "bg-sky-50/75 hover:bg-sky-100/80",
        cardBorder: "border-sky-200 hover:border-sky-400",
        badgeText: "text-sky-900",
        dotColor: "bg-sky-600",
      },
      {
        key: "DUE_OUT",
        label: "Due Out",
        subLabel: "Bugün Çıkış",
        barColor: "bg-amber-400",
        cardBg: "bg-amber-50/80 hover:bg-amber-100/85",
        cardBorder: "border-amber-200 hover:border-amber-400",
        badgeText: "text-amber-950",
        dotColor: "bg-amber-500",
      },
      {
        key: "AVAILABLE",
        label: "Available",
        subLabel: "Müsait / Boş",
        barColor: "bg-emerald-500",
        cardBg: "bg-emerald-50/75 hover:bg-emerald-100/80",
        cardBorder: "border-emerald-200 hover:border-emerald-400",
        badgeText: "text-emerald-900",
        dotColor: "bg-emerald-500",
      },
      {
        key: "OOO_CTS",
        label: "OOO / CTS",
        subLabel: "Satış Dışı / Bakım",
        barColor: "bg-rose-500",
        cardBg: "bg-rose-50/75 hover:bg-rose-100/80",
        cardBorder: "border-rose-200 hover:border-rose-400",
        badgeText: "text-rose-900",
        dotColor: "bg-rose-500",
      },
    ];

    const computed: StatusGroupSummary[] = defs.map((def) => {
      const list = buckets[def.key];
      const count = list.length;
      const pct = total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
      return {
        ...def,
        count,
        pct,
        byCategory: buildCategoryBreakdown(list),
      };
    });

    return { groups: computed, totalRooms: total };
  }, [rooms, reservations, categories, systemToday]);

  const renderIcon = (key: OccupancySummaryKey) => {
    if (key === "INHOUSE") return <BedDouble className="w-3.5 h-3.5 text-sky-700" />;
    if (key === "DUE_OUT") return <LogOut className="w-3.5 h-3.5 text-amber-700" />;
    if (key === "AVAILABLE") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />;
    return <Wrench className="w-3.5 h-3.5 text-rose-700" />;
  };

  return (
    <section className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs flex flex-col gap-3 overflow-visible transition-colors">
      {/* Başlık */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-sky-600" />
          <h3 className="font-extrabold text-slate-800 text-xs tracking-wide">
            Room Status Summary
          </h3>
          <span className="text-[11px] text-slate-500 font-medium">
            · Kategori bazlı dağılım için durum kartlarının üzerine gelin
          </span>
        </div>
        <span className="text-[11px] font-mono font-bold text-slate-700 tabular-nums">
          Toplam: {totalRooms} Oda
        </span>
      </div>

      {/* Oransal Dağılım Çubuğu */}
      <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden flex border border-slate-200">
        {groups.map((g) =>
          g.count > 0 ? (
            <div
              key={`seg-${g.key}`}
              style={{ width: `${(g.count / Math.max(1, totalRooms)) * 100}%` }}
              className={`${g.barColor} transition-all`}
              title={`${g.label}: ${g.count} Oda (%${g.pct})`}
            />
          ) : null
        )}
      </div>

      {/* 4 Durum Kartı (Hoverable Tooltip ile Kategori Dağılımı) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {groups.map((g, idx) => {
          const isTooltipOpen = hoveredKey === g.key;
          const alignClass =
            idx === 0
              ? "left-0"
              : idx === groups.length - 1
                ? "right-0"
                : "left-1/2 -translate-x-1/2";

          return (
            <div
              key={g.key}
              tabIndex={0}
              onMouseEnter={() => setHoveredKey(g.key)}
              onMouseLeave={() => setHoveredKey((prev) => (prev === g.key ? null : prev))}
              onFocus={() => setHoveredKey(g.key)}
              onBlur={() => setHoveredKey((prev) => (prev === g.key ? null : prev))}
              className={`relative rounded-md border p-2.5 transition-colors cursor-default focus:outline-none focus:ring-2 focus:ring-sky-500 ${g.cardBg} ${g.cardBorder}`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${g.dotColor}`} />
                  <span className={`font-extrabold text-xs ${g.badgeText}`}>{g.label}</span>
                </div>
                {renderIcon(g.key)}
              </div>

              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <span className="text-xl font-extrabold text-slate-900 font-mono tabular-nums leading-none">
                  {g.count}
                </span>
                <span className="text-[11px] font-mono font-bold text-slate-600 tabular-nums">
                  %{g.pct}
                </span>
              </div>

              <div className="text-[10px] font-semibold text-slate-500 mt-1">
                {g.subLabel}
              </div>

              {/* Hoverable Tooltip: Kategori Bazlı Oda Sayısı */}
              {isTooltipOpen && (
                <div
                  role="tooltip"
                  className={`absolute bottom-full mb-2 ${alignClass} z-30 w-64 bg-slate-900 text-white rounded-md shadow-xl border border-slate-700 p-3 text-xs pointer-events-none`}
                >
                  <div className="flex items-center justify-between gap-2 pb-1.5 mb-2 border-b border-slate-700">
                    <span className="font-extrabold text-slate-100">
                      {g.label} — Kategori Dağılımı
                    </span>
                    <span className="font-mono font-extrabold text-sky-400 tabular-nums">
                      {g.count} Oda
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    {g.byCategory.map((catItem) => (
                      <div
                        key={catItem.categoryId}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span
                          className={`truncate ${
                            catItem.count > 0 ? "text-slate-100 font-semibold" : "text-slate-500"
                          }`}
                        >
                          {catItem.categoryName}
                        </span>
                        <span
                          className={`font-mono font-bold tabular-nums shrink-0 ${
                            catItem.count > 0 ? "text-sky-300" : "text-slate-600"
                          }`}
                        >
                          {catItem.count}
                          {catItem.roomNumbers.length > 0 && (
                            <span className="text-slate-400 font-normal ml-1">
                              ({catItem.roomNumbers.join(", ")})
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
