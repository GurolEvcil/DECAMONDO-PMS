import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { TrendingUp, ChevronDown, ChevronUp, Flame, Calendar } from "lucide-react";
import type { Reservation, HotelRoom, RoomCategory } from "../App";

interface RoomOccupancyTrendsProps {
  reservations: Reservation[];
  rooms: HotelRoom[];
  categories: RoomCategory[];
  systemToday: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  "CAT-1": "#0284c7", // Sky 600
  "CAT-2": "#059669", // Emerald 600
  "CAT-3": "#d97706", // Amber 600
  "CAT-4": "#7c3aed", // Violet 600
  "CAT-5": "#e11d48", // Rose 600
  "CAT-6": "#0d9488", // Teal 600
  "CAT-7": "#2563eb", // Blue 600
  "CAT-8": "#ea580c", // Orange 600
};

const FALLBACK_COLORS = [
  "#0284c7",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#e11d48",
  "#0d9488",
  "#2563eb",
  "#ea580c",
];

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function shiftISO(iso: string, delta: number): string {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + delta);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortTrDate(iso: string): string {
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${months[Number(m) - 1]}`;
}

interface DayDataPoint {
  dateISO: string;
  label: string;
  isToday: boolean;
  overall: number;
  totalOccupied: number;
  totalRooms: number;
  [key: string]: string | number | boolean;
}

export default function RoomOccupancyTrends({
  reservations,
  rooms,
  categories,
  systemToday,
}: RoomOccupancyTrendsProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [visibleCatIds, setVisibleCatIds] = useState<string[]>(() =>
    categories.map((c) => c.id)
  );
  const [showOverallLine, setShowOverallLine] = useState(true);

  const getColor = (catId: string, idx: number) =>
    CATEGORY_COLORS[catId] || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];

  const { chartData, peakDay, topCategory, todayOverall } = useMemo(() => {
    const days: string[] = [];
    for (let offset = -6; offset <= 0; offset++) {
      days.push(shiftISO(systemToday, offset));
    }

    const roomCountByCat: Record<string, number> = {};
    categories.forEach((cat) => {
      roomCountByCat[cat.id] = rooms.filter((r) => r.categoryId === cat.id).length;
    });
    const totalHotelRooms = rooms.length || 1;

    const categorySumPct: Record<string, number> = {};
    categories.forEach((cat) => {
      categorySumPct[cat.id] = 0;
    });

    const data: DayDataPoint[] = days.map((dayISO) => {
      const isToday = dayISO === systemToday;
      const point: DayDataPoint = {
        dateISO: dayISO,
        label: isToday ? `${formatShortTrDate(dayISO)} (Bugün)` : formatShortTrDate(dayISO),
        isToday,
        overall: 0,
        totalOccupied: 0,
        totalRooms: totalHotelRooms,
      };

      let dayOccupiedTotal = 0;

      categories.forEach((cat) => {
        const catCapacity = roomCountByCat[cat.id] || 0;
        const occupiedForCat = reservations.filter((r) => {
          if (r.categoryId !== cat.id) return false;
          if (r.lifecycle === "CANCELLED") return false;
          if (isToday && r.lifecycle === "CHECKED_OUT") return false;
          return r.checkIn <= dayISO && dayISO < r.checkOut;
        }).length;

        const cappedOccupied = Math.min(catCapacity, occupiedForCat);
        const pct = catCapacity > 0 ? Math.round((cappedOccupied / catCapacity) * 100) : 0;

        point[cat.id] = pct;
        point[`${cat.id}_occ`] = cappedOccupied;
        point[`${cat.id}_cap`] = catCapacity;

        dayOccupiedTotal += cappedOccupied;
        categorySumPct[cat.id] += pct;
      });

      point.totalOccupied = dayOccupiedTotal;
      point.overall = Math.round((dayOccupiedTotal / totalHotelRooms) * 100);
      return point;
    });

    let bestDay = data[0];
    data.forEach((d) => {
      if (d.overall >= bestDay.overall) {
        bestDay = d;
      }
    });

    let bestCat = categories[0];
    let bestCatAvg = -1;
    categories.forEach((cat) => {
      const avg = Math.round(categorySumPct[cat.id] / days.length);
      if (avg > bestCatAvg) {
        bestCatAvg = avg;
        bestCat = cat;
      }
    });

    return {
      chartData: data,
      peakDay: bestDay,
      topCategory: { name: bestCat?.name || "", avg: Math.max(0, bestCatAvg) },
      todayOverall: data[data.length - 1]?.overall ?? 0,
    };
  }, [reservations, rooms, categories, systemToday]);

  const toggleCategory = (catId: string) => {
    setVisibleCatIds((prev) => {
      if (prev.includes(catId)) {
        return prev.length > 1 ? prev.filter((id) => id !== catId) : prev;
      }
      return [...prev, catId];
    });
  };

  const handleSelectAll = () => {
    setVisibleCatIds(categories.map((c) => c.id));
  };

  const handleSelectTopFour = () => {
    setVisibleCatIds(categories.slice(0, 4).map((c) => c.id));
  };

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden no-print">
      {/* Başlık ve Zirve Talep Özeti */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-sky-600" />
            <h2 className="text-sm font-extrabold text-slate-900 tracking-wide">
              Room Occupancy Trends
            </h2>
            <span className="text-xs text-slate-500 font-medium">
              · Son 7 Gün Kategori Bazlı Doluluk (%)
            </span>
          </div>

          <span className="text-slate-300 hidden md:inline">|</span>

          {/* Zirve Talep Bilgileri (Sade Metin, Rozet Yığını Yok) */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-600" />
              <span>Zirve Gün:</span>
              <strong className="text-slate-900 font-mono tabular-nums">
                {formatShortTrDate(peakDay.dateISO)} (%{peakDay.overall})
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>
              En Yoğun Tip:{" "}
              <strong className="text-slate-900">
                {topCategory.name}
              </strong>{" "}
              <span className="font-mono tabular-nums text-sky-700 font-bold">
                (%{topCategory.avg} ort.)
              </span>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>Bugün:</span>
              <strong className="text-emerald-700 font-mono tabular-nums">
                %{todayOverall}
              </strong>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold whitespace-nowrap cursor-pointer"
        >
          <span>{isExpanded ? "Grafiği Daralt" : "Grafiği Göster"}</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="p-4 flex flex-col gap-3">
          {/* Kategori Filtre Çubuğu */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((cat, idx) => {
                const active = visibleCatIds.includes(cat.id);
                const color = getColor(cat.id, idx);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold border transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: color, opacity: active ? 1 : 0.4 }}
                    />
                    <span>{cat.name}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowOverallLine((prev) => !prev)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold border whitespace-nowrap cursor-pointer ${
                  showOverallLine
                    ? "bg-slate-100 border-slate-400 text-slate-900"
                    : "bg-white border-slate-300 text-slate-500 hover:bg-slate-50"
                }`}
              >
                Genel Doluluk Çizgisi
              </button>
              <button
                type="button"
                onClick={handleSelectTopFour}
                className="px-2 py-1 rounded text-[11px] font-bold border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 whitespace-nowrap cursor-pointer"
              >
                İlk 4
              </button>
              <button
                type="button"
                onClick={handleSelectAll}
                className="px-2 py-1 rounded text-[11px] font-bold border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 whitespace-nowrap cursor-pointer"
              >
                Tümü (8)
              </button>
            </div>
          </div>

          {/* Recharts Çizgi Grafiği */}
          <div className="w-full h-[270px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 12, right: 18, left: -12, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#475569", fontWeight: 600 }}
                  axisLine={{ stroke: "#cbd5e1" }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(val) => `%${val}`}
                  tick={{ fontSize: 11, fill: "#475569", fontFamily: "JetBrains Mono, monospace" }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine
                  x={peakDay.label}
                  stroke="#d97706"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{
                    value: `Zirve (%${peakDay.overall})`,
                    position: "top",
                    fill: "#b45309",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const row = payload[0].payload as DayDataPoint;
                    const sortedSeries = categories
                      .filter((c) => visibleCatIds.includes(c.id))
                      .map((cat, idx) => ({
                        cat,
                        color: getColor(cat.id, idx),
                        pct: Number(row[cat.id] ?? 0),
                        occ: Number(row[`${cat.id}_occ`] ?? 0),
                        cap: Number(row[`${cat.id}_cap`] ?? 0),
                      }))
                      .sort((a, b) => b.pct - a.pct);

                    return (
                      <div className="bg-slate-900 text-white rounded-md shadow-xl border border-slate-700 p-3 text-xs min-w-[240px]">
                        <div className="flex items-center justify-between gap-4 pb-1.5 mb-2 border-b border-slate-700">
                          <span className="font-bold text-slate-100">{row.label}</span>
                          <span className="font-mono font-extrabold text-sky-400 tabular-nums">
                            Genel: %{row.overall} ({row.totalOccupied}/{row.totalRooms})
                          </span>
                        </div>
                        <div className="flex flex-col gap-1">
                          {sortedSeries.map(({ cat, color, pct, occ, cap }) => (
                            <div
                              key={cat.id}
                              className="flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className="w-2 h-2 rounded-xs shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                                <span className="text-slate-200 truncate">{cat.name}</span>
                              </div>
                              <span className="font-mono font-bold tabular-nums shrink-0 text-white">
                                %{pct}{" "}
                                <span className="text-slate-400 font-normal">
                                  ({occ}/{cap})
                                </span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }}
                />

                {showOverallLine && (
                  <Line
                    type="monotone"
                    dataKey="overall"
                    name="Genel Doluluk"
                    stroke="#0f172a"
                    strokeWidth={2.5}
                    strokeDasharray="5 4"
                    dot={{ r: 3.5, fill: "#0f172a", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                )}

                {categories.map((cat, idx) => {
                  if (!visibleCatIds.includes(cat.id)) return null;
                  const color = getColor(cat.id, idx);
                  return (
                    <Line
                      key={cat.id}
                      type="monotone"
                      dataKey={cat.id}
                      name={cat.name}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ r: 3, fill: color, strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
