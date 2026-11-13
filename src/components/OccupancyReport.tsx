import React, { useMemo, useState } from "react";
import {
  BarChart3,
  Download,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  BedDouble,
} from "lucide-react";
import type { Reservation, HotelRoom, RoomCategory } from "../App";

interface OccupancyReportProps {
  reservations: Reservation[];
  rooms: HotelRoom[];
  categories: RoomCategory[];
  systemToday: string;
}

type ReportSortField =
  | "category"
  | "roomCount"
  | "roomNightsSold"
  | "occupancyPct"
  | "revenue"
  | "adr";
type SortDir = "asc" | "desc";
type LifecycleScope = "ALL" | "REALIZED" | "CONFIRMED";

const TR_MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

function parseISO(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(isoDate: string, delta: number): string {
  const dt = parseISO(isoDate);
  dt.setDate(dt.getDate() + delta);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function calcNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 1;
  const diff = Math.round(
    (parseISO(checkOut).getTime() - parseISO(checkIn).getTime()) / (1000 * 60 * 60 * 24)
  );
  return diff > 0 ? diff : 1;
}

function formatMonthLabel(ym: string): string {
  if (ym === "ALL") return "Tüm Aylar (Genel)";
  const [y, m] = ym.split("-").map(Number);
  return `${TR_MONTHS[(m || 1) - 1]} ${y}`;
}

function getDaysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

interface CategoryReportRow {
  categoryId: string;
  categoryName: string;
  defaultRate: number;
  roomCount: number;
  reservationCount: number;
  roomNightsSold: number;
  availableRoomNights: number;
  occupancyPct: number;
  revenue: number;
  adr: number;
  revenueSharePct: number;
}

export default function OccupancyReport({
  reservations,
  rooms,
  categories,
  systemToday,
}: OccupancyReportProps) {
  const currentMonth = systemToday.slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonth);
  const [lifecycleScope, setLifecycleScope] = useState<LifecycleScope>("ALL");
  const [sortField, setSortField] = useState<ReportSortField>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Rezervasyon geçmişindeki tüm ayları otomatik keşfet
  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>([currentMonth]);
    reservations.forEach((r) => {
      const n = r.nights > 0 ? r.nights : calcNights(r.checkIn, r.checkOut);
      for (let i = 0; i < n; i++) {
        const nightISO = addDays(r.checkIn, i);
        monthSet.add(nightISO.slice(0, 7));
      }
    });
    return Array.from(monthSet).sort((a, b) => b.localeCompare(a));
  }, [reservations, currentMonth]);

  // Seçili aya ve duruma göre kategori bazlı Oda-Gece, Gelir ve ADR hesaplaması
  const { rows, totals } = useMemo(() => {
    const scopedReservations = reservations.filter((r) => {
      if (lifecycleScope === "REALIZED") {
        return r.lifecycle === "INHOUSE" || r.lifecycle === "CHECKED_OUT";
      }
      if (lifecycleScope === "CONFIRMED") {
        return r.lifecycle === "CONFIRMED";
      }
      return r.lifecycle !== "CANCELLED";
    });

    const nightsByCat: Record<string, number> = {};
    const revenueByCat: Record<string, number> = {};
    const resIdsByCat: Record<string, Set<string>> = {};

    categories.forEach((c) => {
      nightsByCat[c.id] = 0;
      revenueByCat[c.id] = 0;
      resIdsByCat[c.id] = new Set<string>();
    });

    const distinctMonthsUsed = new Set<string>();

    scopedReservations.forEach((r) => {
      const stayNights = r.nights > 0 ? r.nights : calcNights(r.checkIn, r.checkOut);
      const extraSum = (r.extraCharges || []).reduce(
        (acc, item) => acc + (Number(item.amount) || 0),
        0
      );
      const accommodationTotal = Math.max(0, (Number(r.totalAmount) || 0) - extraSum);
      const nightlyRate = stayNights > 0 ? accommodationTotal / stayNights : 0;

      for (let i = 0; i < stayNights; i++) {
        const nightISO = addDays(r.checkIn, i);
        const ym = nightISO.slice(0, 7);
        if (selectedMonth !== "ALL" && ym !== selectedMonth) continue;

        distinctMonthsUsed.add(ym);
        if (nightsByCat[r.categoryId] === undefined) {
          nightsByCat[r.categoryId] = 0;
          revenueByCat[r.categoryId] = 0;
          resIdsByCat[r.categoryId] = new Set<string>();
        }
        nightsByCat[r.categoryId] += 1;
        revenueByCat[r.categoryId] += nightlyRate;
        resIdsByCat[r.categoryId].add(r.id);
      }
    });

    const periodDays =
      selectedMonth === "ALL"
        ? Math.max(1, distinctMonthsUsed.size) * 30
        : getDaysInMonth(selectedMonth);

    const totalRevenueAll = Object.values(revenueByCat).reduce((acc, v) => acc + v, 0);
    const totalNightsAll = Object.values(nightsByCat).reduce((acc, v) => acc + v, 0);

    const computedRows: CategoryReportRow[] = categories.map((cat) => {
      const roomCount = rooms.filter((rm) => rm.categoryId === cat.id).length;
      const sold = nightsByCat[cat.id] || 0;
      const rev = Math.round(revenueByCat[cat.id] || 0);
      const availNights = roomCount * periodDays;
      const occPct = availNights > 0 ? Math.min(100, Number(((sold / availNights) * 100).toFixed(1))) : 0;
      const adr = sold > 0 ? Math.round(rev / sold) : 0;
      const share = totalRevenueAll > 0 ? Number(((rev / totalRevenueAll) * 100).toFixed(1)) : 0;

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        defaultRate: cat.defaultRate,
        roomCount,
        reservationCount: resIdsByCat[cat.id]?.size || 0,
        roomNightsSold: sold,
        availableRoomNights: availNights,
        occupancyPct: occPct,
        revenue: rev,
        adr,
        revenueSharePct: share,
      };
    });

    const sortedRows = [...computedRows].sort((a, b) => {
      let cmp = 0;
      if (sortField === "category") cmp = a.categoryName.localeCompare(b.categoryName, "tr-TR");
      else if (sortField === "roomCount") cmp = a.roomCount - b.roomCount;
      else if (sortField === "roomNightsSold") cmp = a.roomNightsSold - b.roomNightsSold;
      else if (sortField === "occupancyPct") cmp = a.occupancyPct - b.occupancyPct;
      else if (sortField === "revenue") cmp = a.revenue - b.revenue;
      else if (sortField === "adr") cmp = a.adr - b.adr;
      return sortDir === "asc" ? cmp : -cmp;
    });

    const totalAvailableNights = rooms.length * periodDays;
    const roundedTotalRev = Math.round(totalRevenueAll);
    const overallAdr = totalNightsAll > 0 ? Math.round(roundedTotalRev / totalNightsAll) : 0;
    const overallOccPct =
      totalAvailableNights > 0
        ? Math.min(100, Number(((totalNightsAll / totalAvailableNights) * 100).toFixed(1)))
        : 0;

    return {
      rows: sortedRows,
      totals: {
        roomCount: rooms.length,
        roomNightsSold: totalNightsAll,
        availableRoomNights: totalAvailableNights,
        occupancyPct: overallOccPct,
        revenue: roundedTotalRev,
        adr: overallAdr,
      },
    };
  }, [reservations, rooms, categories, selectedMonth, lifecycleScope, sortField, sortDir]);

  const toggleSort = (field: ReportSortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const renderSortIcon = (field: ReportSortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-400" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 text-sky-600" />
    ) : (
      <ArrowDown className="w-3 h-3 text-sky-600" />
    );
  };

  const handleExportCsv = () => {
    const headers = [
      "Donem",
      "Oda Kategorisi",
      "Oda Adedi",
      "Satilan Oda-Gece",
      "Aylik Doluluk (%)",
      "Toplam Gelir (TL)",
      "ADR (TL)",
      "Gelir Payi (%)",
    ];
    const periodText = formatMonthLabel(selectedMonth);
    const csvLines = [
      headers.join(","),
      ...rows.map((r) =>
        [
          `"${periodText}"`,
          `"${r.categoryName}"`,
          r.roomCount,
          r.roomNightsSold,
          r.occupancyPct,
          r.revenue,
          r.adr,
          r.revenueSharePct,
        ].join(",")
      ),
      [
        `"${periodText}"`,
        `"TOPLAM"`,
        totals.roomCount,
        totals.roomNightsSold,
        totals.occupancyPct,
        totals.revenue,
        totals.adr,
        100,
      ].join(","),
    ];

    const blob = new Blob(["\uFEFF" + csvLines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stayflow-occupancy-report-${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col overflow-hidden">
      {/* Üst Başlık ve Filtre Çubuğu */}
      <div className="p-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="w-4 h-4 text-sky-600" />
          <div>
            <h1 className="text-sm font-extrabold text-slate-900 tracking-wide">
              OCCUPANCY REPORT — AYLIK DOLULUK, GELİR & ADR ÖZETİ
            </h1>
            <p className="text-[11px] text-slate-500 font-medium">
              Rezervasyon geçmişinden kategori bazlı satılan oda-gece, toplam gelir ve ortalama günlük fiyat (ADR)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          {/* Ay Seçici */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-md px-2.5 py-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Rapor Ayı Seç"
              className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none"
            >
              {availableMonths.map((ym) => (
                <option key={ym} value={ym}>
                  {formatMonthLabel(ym)}
                </option>
              ))}
              <option value="ALL">Tüm Aylar (Genel)</option>
            </select>
          </div>

          {/* Kapsam Seçici */}
          <select
            value={lifecycleScope}
            onChange={(e) => setLifecycleScope(e.target.value as LifecycleScope)}
            aria-label="Rezervasyon Kapsamı"
            className="text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-sky-600"
          >
            <option value="ALL">Tüm Rezervasyonlar</option>
            <option value="REALIZED">Gerçekleşen (Inhouse + Checked-Out)</option>
            <option value="CONFIRMED">Yalnızca Onaylı (Confirmed)</option>
          </select>

          {/* CSV İndir */}
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV İndir</span>
          </button>
        </div>
      </div>

      {/* Üst Özet Metrik Şeridi */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-white text-xs">
        <div className="p-3.5 flex items-center justify-between">
          <div>
            <div className="text-slate-500 font-semibold">Satılan Toplam Oda-Gece</div>
            <div className="text-lg font-extrabold text-slate-900 font-mono tabular-nums mt-0.5">
              {totals.roomNightsSold.toLocaleString("tr-TR")} Gece
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-500 tabular-nums">
            / {totals.availableRoomNights} Kapasite
          </span>
        </div>

        <div className="p-3.5 flex items-center justify-between">
          <div>
            <div className="text-slate-500 font-semibold">Dönem Toplam Geliri</div>
            <div className="text-lg font-extrabold text-emerald-700 font-mono tabular-nums mt-0.5">
              {totals.revenue.toLocaleString("tr-TR")} TL
            </div>
          </div>
          <span className="text-[11px] font-semibold text-slate-500">
            {formatMonthLabel(selectedMonth)}
          </span>
        </div>

        <div className="p-3.5 flex items-center justify-between">
          <div>
            <div className="text-slate-500 font-semibold">Ortalama Günlük Fiyat (ADR)</div>
            <div className="text-lg font-extrabold text-sky-700 font-mono tabular-nums mt-0.5">
              {totals.adr.toLocaleString("tr-TR")} TL
            </div>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">Gelir / Oda-Gece</span>
        </div>

        <div className="p-3.5 flex items-center justify-between">
          <div>
            <div className="text-slate-500 font-semibold">Dönem Doluluk Oranı</div>
            <div className="text-lg font-extrabold text-slate-900 font-mono tabular-nums mt-0.5">
              %{totals.occupancyPct}
            </div>
          </div>
          <BedDouble className="w-5 h-5 text-slate-300" />
        </div>
      </div>

      {/* Aylık Özet Tablosu */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
              <th className="py-2.5 px-3.5">
                <button
                  type="button"
                  onClick={() => toggleSort("category")}
                  className="flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                >
                  <span>ODA KATEGORİSİ</span>
                  {renderSortIcon("category")}
                </button>
              </th>
              <th className="py-2.5 px-3.5 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort("roomCount")}
                  className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                >
                  <span>ODA ADEDİ</span>
                  {renderSortIcon("roomCount")}
                </button>
              </th>
              <th className="py-2.5 px-3.5 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort("roomNightsSold")}
                  className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                >
                  <span>SATILAN ODA-GECE</span>
                  {renderSortIcon("roomNightsSold")}
                </button>
              </th>
              <th className="py-2.5 px-3.5 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort("occupancyPct")}
                  className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                >
                  <span>DOLULUK (%)</span>
                  {renderSortIcon("occupancyPct")}
                </button>
              </th>
              <th className="py-2.5 px-3.5 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort("revenue")}
                  className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                >
                  <span>KATEGORİ GELİRİ</span>
                  {renderSortIcon("revenue")}
                </button>
              </th>
              <th className="py-2.5 px-3.5 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort("adr")}
                  className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                >
                  <span>ADR (ORT. GÜNLÜK)</span>
                  {renderSortIcon("adr")}
                </button>
              </th>
              <th className="py-2.5 px-3.5 text-right">GELİR PAYI</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200">
            {rows.map((row) => (
              <tr key={row.categoryId} className="hover:bg-sky-50/40 transition-colors">
                <td className="py-2.5 px-3.5">
                  <div className="font-bold text-slate-900">{row.categoryName}</div>
                  <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                    Liste Fiyatı: {row.defaultRate.toLocaleString("tr-TR")} TL ·{" "}
                    {row.reservationCount} konaklama
                  </div>
                </td>
                <td className="py-2.5 px-3.5 text-right font-mono font-semibold text-slate-700 tabular-nums">
                  {row.roomCount}
                </td>
                <td className="py-2.5 px-3.5 text-right font-mono font-extrabold text-slate-900 tabular-nums">
                  {row.roomNightsSold.toLocaleString("tr-TR")}
                </td>
                <td className="py-2.5 px-3.5 text-right">
                  <div className="inline-flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden hidden sm:block">
                      <div
                        className="h-full bg-sky-600 rounded-full"
                        style={{ width: `${row.occupancyPct}%` }}
                      />
                    </div>
                    <span className="font-mono font-bold text-slate-800 tabular-nums w-11 text-right">
                      %{row.occupancyPct}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-3.5 text-right font-mono font-extrabold text-emerald-800 tabular-nums">
                  {row.revenue.toLocaleString("tr-TR")} TL
                </td>
                <td className="py-2.5 px-3.5 text-right font-mono font-bold text-sky-800 tabular-nums">
                  {row.adr > 0 ? `${row.adr.toLocaleString("tr-TR")} TL` : "—"}
                </td>
                <td className="py-2.5 px-3.5 text-right font-mono font-semibold text-slate-600 tabular-nums">
                  %{row.revenueSharePct}
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="bg-slate-900 text-white font-bold text-xs">
              <td className="py-3 px-3.5 tracking-wide">TOPLAM / GENEL ÖZET</td>
              <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                {totals.roomCount}
              </td>
              <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                {totals.roomNightsSold.toLocaleString("tr-TR")}
              </td>
              <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                %{totals.occupancyPct}
              </td>
              <td className="py-3 px-3.5 text-right font-mono text-emerald-400 tabular-nums">
                {totals.revenue.toLocaleString("tr-TR")} TL
              </td>
              <td className="py-3 px-3.5 text-right font-mono text-sky-300 tabular-nums">
                {totals.adr.toLocaleString("tr-TR")} TL
              </td>
              <td className="py-3 px-3.5 text-right font-mono tabular-nums">%100</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
