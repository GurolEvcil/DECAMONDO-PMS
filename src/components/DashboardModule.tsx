"use client";

import React, { useMemo, useState } from "react";
import {
  TrendingUp,
  CalendarDays,
  BarChart3,
  PieChart as PieChartIcon,
  RefreshCw,
  Tag,
  History,
  ArrowRight,
  UserCheck,
} from "lucide-react";
import type { DailyRateLogEntry } from "../App";
import RoomStatusSummaryWidget from "./RoomStatusSummaryWidget";

// Mevcut uygulamadaki tiplerle birebir uyumlu arayüzler
export interface DashboardRoom {
  roomNumber: string;
  floor: number;
  categoryId: string;
  physicalStatus: "AVAILABLE" | "OUT_OF_ORDER" | "CLOSED_TO_SALES";
  isDirty?: boolean;
}

export interface DashboardReservation {
  id: string;
  roomNumber: string | null;
  firstName: string;
  lastName: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  categoryId: string;
  lifecycle: "CONFIRMED" | "INHOUSE" | "CHECKED_OUT" | "CANCELLED";
  totalAmount?: number;
  nights?: number;
}

export interface DashboardCategory {
  id: string;
  name: string;
  defaultRate: number;
}

export interface ExchangeRatesMap {
  TRY: number;
  EUR: number;
  USD: number;
  GBP: number;
}

export interface TcmbRateItem {
  code: "TRY" | "USD" | "EUR" | "GBP";
  name: string;
  forexBuying: number;
  forexSelling: number;
}

export type TcmbRateType = "FOREX_BUYING" | "FOREX_SELLING";

export interface SystemExchangeState {
  bulletinDate: string;
  lastUpdatedAt: string;
  activeRateType: TcmbRateType;
  rates: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem>;
}

export interface ExchangeRatesMeta {
  date: string;
  bulletinDate: string;
  source: string;
  updatedAt: string;
}

export type DashboardNavTarget = "INHOUSE_RACK" | "ARRIVALS" | "DUE_OUTS" | "END_OF_DAY";

interface DashboardModuleProps {
  rooms: DashboardRoom[];
  reservations: DashboardReservation[];
  categories: DashboardCategory[];
  systemToday: string; // Örn: "2026-11-13"
  onUpdateCategoryRate?: (categoryId: string, newRate: number) => void;
  dailyRateLogs?: DailyRateLogEntry[];
  onRecordRateChange?: (
    categoryId: string,
    oldRate: number,
    newRate: number,
    source?: string
  ) => void;
  exchangeRates?: ExchangeRatesMap;
  exchangeState?: SystemExchangeState;
  ratesMeta?: ExchangeRatesMeta;
  isFetchingRates?: boolean;
  onRefreshTcmbRates?: () => Promise<void>;
  onChangeActiveRateType?: (rateType: TcmbRateType) => Promise<void>;
  onUpdateExchangeRates?: (nextRates: ExchangeRatesMap) => Promise<void>;
  onNavigateModule?: (target: DashboardNavTarget) => void;
}

function parseLocalISO(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(isoDate: string, days: number): string {
  const dt = parseLocalISO(isoDate);
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortDay(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `${d}.${m}`;
}

function formatCompactTL(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(amount);
}

export default function DashboardModule({
  rooms,
  reservations,
  categories,
  systemToday,
  onUpdateCategoryRate,
  dailyRateLogs,
  onRecordRateChange,
  exchangeRates,
  exchangeState,
  ratesMeta,
  isFetchingRates,
  onRefreshTcmbRates,
  onChangeActiveRateType,
  onNavigateModule,
}: DashboardModuleProps) {
  const totalRooms = rooms.length || 20;

  // Fallback yerel tarife ve audit log (prop verilmezse bağımsız çalışır)
  const [localRates, setLocalRates] = useState<Record<string, number>>({});
  const [localLogs, setLocalLogs] = useState<DailyRateLogEntry[]>([]);
  const [ratePanelTab, setRatePanelTab] = useState<"RATES" | "HISTORY">("RATES");
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState<string>("ALL");
  const editOriginRatesRef = React.useRef<Record<string, number>>({});

  const activeRateType: TcmbRateType = exchangeState?.activeRateType ?? "FOREX_BUYING";
  const effectiveTcmbTable: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem> = exchangeState?.rates ?? {
    TRY: { code: "TRY", name: "TÜRK LİRASI", forexBuying: 1, forexSelling: 1 },
    USD: {
      code: "USD",
      name: "ABD DOLARI",
      forexBuying: exchangeRates?.USD ?? 34.821,
      forexSelling: exchangeRates?.USD ?? 34.8837,
    },
    EUR: {
      code: "EUR",
      name: "EURO",
      forexBuying: exchangeRates?.EUR ?? 37.452,
      forexSelling: exchangeRates?.EUR ?? 37.5194,
    },
    GBP: {
      code: "GBP",
      name: "İNGİLİZ STERLİNİ",
      forexBuying: exchangeRates?.GBP ?? 44.151,
      forexSelling: exchangeRates?.GBP ?? 44.3812,
    },
  };

  const effectiveLogs = dailyRateLogs ?? localLogs;

  const filteredRateLogs = useMemo(() => {
    if (historyCategoryFilter === "ALL") return effectiveLogs;
    return effectiveLogs.filter((entry) => entry.categoryId === historyCategoryFilter);
  }, [effectiveLogs, historyCategoryFilter]);

  const getEffectiveRate = (cat: DashboardCategory): number => {
    if (localRates[cat.id] !== undefined) return localRates[cat.id];
    return cat.defaultRate ?? 0;
  };

  const handleRateFocus = (cat: DashboardCategory) => {
    if (editOriginRatesRef.current[cat.id] === undefined) {
      editOriginRatesRef.current[cat.id] = getEffectiveRate(cat);
    }
  };

  const commitRateAudit = (cat: DashboardCategory) => {
    const oldRate = editOriginRatesRef.current[cat.id];
    const currentRate = getEffectiveRate(cat);
    if (oldRate === undefined) return;
    delete editOriginRatesRef.current[cat.id];

    if (oldRate === currentRate) return;

    if (onRecordRateChange) {
      onRecordRateChange(cat.id, oldRate, currentRate, "Dashboard Kategori Ayarları");
    } else {
      const now = new Date();
      const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
      const ts = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()} · ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      setLocalLogs((prev) => [
        {
          id: `RATE-LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          categoryId: cat.id,
          categoryName: cat.name,
          oldRate,
          newRate: currentRate,
          changedBy: "Otel Müdürü",
          changedByRole: "MANAGER",
          timestamp: ts,
          source: "Dashboard Kategori Ayarları",
        },
        ...prev,
      ]);
    }
  };

  const handleRateChange = (categoryId: string, rawVal: string) => {
    const parsed = Math.max(0, Math.round(Number(rawVal) || 0));
    if (onUpdateCategoryRate) {
      onUpdateCategoryRate(categoryId, parsed);
    } else {
      setLocalRates((prev) => ({ ...prev, [categoryId]: parsed }));
    }
  };

  // ==========================================================================
  // 1. CANLI KPI VE "ŞİMDİKİ DURUM" TABLOSU HESAPLAMALARI
  // ==========================================================================
  const stats = useMemo(() => {
    // Şu an otelde konaklayanlar (INHOUSE)
    const inhouseNow = reservations.filter((r) => r.lifecycle === "INHOUSE").length;

    // Bugün gerçekleşen girişler (checkIn === today && INHOUSE)
    const realizedArrivals = reservations.filter(
      (r) => r.checkIn === systemToday && r.lifecycle === "INHOUSE"
    ).length;

    // Bugün beklenen girişler (checkIn === today && CONFIRMED)
    const expectedArrivals = reservations.filter(
      (r) => r.checkIn === systemToday && r.lifecycle === "CONFIRMED"
    ).length;

    // Bugün ayrılmış odalar (checkOut === today && CHECKED_OUT)
    const departedToday = reservations.filter(
      (r) => r.checkOut === systemToday && r.lifecycle === "CHECKED_OUT"
    ).length;

    // Bugün beklenen çıkışlar (checkOut === today && INHOUSE)
    const expectedDepartures = reservations.filter(
      (r) => r.checkOut === systemToday && r.lifecycle === "INHOUSE"
    ).length;

    // Sabahki durum = Şimdiki durum - Bugün girenler + Bugün çıkanlar
    const morningOccupied = Math.max(0, inhouseNow - realizedArrivals + departedToday);

    // Gün sonu tahmini = Şimdiki durum + Beklenen girişler - Beklenen çıkışlar
    const endOfDayOccupied = Math.max(
      0,
      Math.min(totalRooms, inhouseNow + expectedArrivals - expectedDepartures)
    );

    // Oda fiziksel ve temizlik dağılımı
    const blockedCount = rooms.filter(
      (r) => r.physicalStatus === "OUT_OF_ORDER" || r.physicalStatus === "CLOSED_TO_SALES"
    ).length;
    const availableCleanCount = Math.max(
      0,
      totalRooms - inhouseNow - blockedCount
    );
    const dirtyRoomsCount = rooms.filter((r) => r.isDirty).length;
    const cleanRoomsCount = Math.max(0, totalRooms - dirtyRoomsCount - blockedCount);

    const pct = (val: number) => `%${((val / totalRooms) * 100).toFixed(1)}`;

    return {
      inhouseNow,
      realizedArrivals,
      expectedArrivals,
      departedToday,
      expectedDepartures,
      morningOccupied,
      endOfDayOccupied,
      blockedCount,
      availableCleanCount,
      dirtyRoomsCount,
      cleanRoomsCount,
      pct,
    };
  }, [reservations, rooms, systemToday, totalRooms]);

  // ==========================================================================
  // 2. 10 GÜNLÜK FORECAST (MÜSAİTLİK, DOLULUK VE PROJEKSİYON GELİRİ)
  // ==========================================================================
  const { forecast10Days, forecastTotals } = useMemo(() => {
    const rateByCatId: Record<string, number> = {};
    const totalRoomsByCatId: Record<string, number> = {};
    const blockedRoomsByCatId: Record<string, number> = {};

    categories.forEach((cat) => {
      rateByCatId[cat.id] = localRates[cat.id] !== undefined ? localRates[cat.id] : cat.defaultRate ?? 0;
      const catRooms = rooms.filter((rm) => rm.categoryId === cat.id);
      totalRoomsByCatId[cat.id] = catRooms.length;
      blockedRoomsByCatId[cat.id] = catRooms.filter(
        (rm) => rm.physicalStatus === "OUT_OF_ORDER" || rm.physicalStatus === "CLOSED_TO_SALES"
      ).length;
    });

    const days = [];
    let sumOccupiedNights = 0;
    let sumAvailableNights = 0;
    let sumOccupiedRevenue = 0;
    let sumPotentialRevenue = 0;

    for (let i = 0; i < 10; i++) {
      const targetDate = addDays(systemToday, i);

      // O gece otelde konaklayacak aktif rezervasyonlar (checkIn <= targetDate < checkOut)
      const activeOnDay = reservations.filter(
        (r) =>
          r.lifecycle !== "CHECKED_OUT" &&
          r.lifecycle !== "CANCELLED" &&
          r.checkIn <= targetDate &&
          r.checkOut > targetDate
      );

      let occupiedRevenue = 0;
      let availableRevenue = 0;

      categories.forEach((cat) => {
        const catRate = rateByCatId[cat.id] || 0;
        const catTotal = totalRoomsByCatId[cat.id] || 0;
        const catBlocked = blockedRoomsByCatId[cat.id] || 0;
        const catSellable = Math.max(0, catTotal - catBlocked);
        const catOccupied = Math.min(
          catSellable,
          activeOnDay.filter((r) => r.categoryId === cat.id).length
        );
        const catAvailable = Math.max(0, catSellable - catOccupied);

        occupiedRevenue += catOccupied * catRate;
        availableRevenue += catAvailable * catRate;
      });

      const occupied = activeOnDay.length;
      const available = Math.max(0, totalRooms - occupied - stats.blockedCount);
      const totalPotentialRevenue = occupiedRevenue + availableRevenue;

      sumOccupiedNights += occupied;
      sumAvailableNights += available;
      sumOccupiedRevenue += occupiedRevenue;
      sumPotentialRevenue += totalPotentialRevenue;

      days.push({
        date: targetDate,
        label: formatShortDay(targetDate),
        occupied,
        available,
        blocked: stats.blockedCount,
        occupiedRevenue,
        availableRevenue,
        totalPotentialRevenue,
      });
    }

    const weightedAdr =
      sumOccupiedNights > 0
        ? Math.round(sumOccupiedRevenue / sumOccupiedNights)
        : sumAvailableNights > 0
          ? Math.round(sumPotentialRevenue / sumAvailableNights)
          : 0;

    return {
      forecast10Days: days,
      forecastTotals: {
        occupiedNights: sumOccupiedNights,
        availableNights: sumAvailableNights,
        occupiedRevenue: sumOccupiedRevenue,
        availableRevenue: sumPotentialRevenue - sumOccupiedRevenue,
        totalPotentialRevenue: sumPotentialRevenue,
        weightedAdr,
      },
    };
  }, [reservations, rooms, categories, localRates, systemToday, totalRooms, stats.blockedCount]);

  // Takvim Kartı İçin Gün/Ay/Yıl Ayrıştırma
  const dateObj = parseLocalISO(systemToday);
  const monthName = dateObj.toLocaleDateString("tr-TR", { month: "long" });
  const dayNumber = dateObj.getDate();
  const yearNumber = dateObj.getFullYear();

  // SVG Pasta Grafik Dilim Hesaplayıcısı
  const totalPie1 = Math.max(
    1,
    stats.inhouseNow + stats.availableCleanCount + stats.blockedCount
  );
  const occDeg = (stats.inhouseNow / totalPie1) * 360;
  const availDeg = (stats.availableCleanCount / totalPie1) * 360;

  const totalPie2 = Math.max(
    1,
    stats.cleanRoomsCount + stats.dirtyRoomsCount + stats.blockedCount
  );
  const cleanDeg = (stats.cleanRoomsCount / totalPie2) * 360;
  const dirtyDeg = (stats.dirtyRoomsCount / totalPie2) * 360;

  return (
    <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
      {/* ====================================================================
          SOL VE ORTA ANA PANEL (9 SÜTUN)
         ==================================================================== */}
      <div className="lg:col-span-9 flex flex-col gap-4">
        {/* 1. ÜST 4 BÜYÜK KPI KARTI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Kart 1: Konaklayan Odalar -> INHOUSE / RACK */}
          <button
            type="button"
            onClick={() => onNavigateModule?.("INHOUSE_RACK")}
            title="INHOUSE / RACK modülüne git"
            className="group bg-[var(--pms-card-bg)] border border-slate-300 hover:border-sky-400 rounded-[var(--pms-radius)] p-3.5 text-center shadow-2xs hover:shadow-md flex flex-col justify-between transition-all duration-200 ease-out hover:scale-105 active:scale-[0.99] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            <span className="font-bold text-slate-600 group-hover:text-sky-700 text-[11px] inline-flex items-center justify-center gap-1 transition-colors">
              <span>Konaklayan Odalar</span>
              <ArrowRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
            </span>
            <div className="my-2">
              <div className="text-3xl font-extrabold text-sky-600 leading-none font-mono tabular-nums">
                {stats.inhouseNow}
              </div>
              <div className="text-[11px] font-semibold text-slate-400 mt-1">Odalar</div>
            </div>
            <div className="pt-1.5 border-t border-slate-100 text-[11px] font-bold text-slate-600 w-full">
              Doluluk: {stats.pct(stats.inhouseNow)}
            </div>
          </button>

          {/* Kart 2: Beklenen Gelişler -> ARRIVALS */}
          <button
            type="button"
            onClick={() => onNavigateModule?.("ARRIVALS")}
            title="ARRIVALS modülüne git"
            className="group bg-[var(--pms-card-bg)] border border-slate-300 hover:border-rose-400 rounded-[var(--pms-radius)] p-3.5 text-center shadow-2xs hover:shadow-md flex flex-col justify-between transition-all duration-200 ease-out hover:scale-105 active:scale-[0.99] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <span className="font-bold text-slate-600 group-hover:text-rose-700 text-[11px] inline-flex items-center justify-center gap-1 transition-colors">
              <span>Beklenen Gelişler</span>
              <ArrowRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
            </span>
            <div className="my-2">
              <div className="text-3xl font-extrabold text-rose-600 leading-none font-mono tabular-nums">
                {stats.expectedArrivals}
              </div>
              <div className="text-[11px] font-semibold text-slate-400 mt-1">Odalar</div>
            </div>
            <div className="pt-1.5 border-t border-slate-100 text-[11px] font-bold text-slate-600 w-full">
              Gerçekleşen: {stats.realizedArrivals} Oda
            </div>
          </button>

          {/* Kart 3: Beklenen Çıkışlar -> DUE OUTS */}
          <button
            type="button"
            onClick={() => onNavigateModule?.("DUE_OUTS")}
            title="DUE OUTS modülüne git"
            className="group bg-[var(--pms-card-bg)] border border-slate-300 hover:border-amber-400 rounded-[var(--pms-radius)] p-3.5 text-center shadow-2xs hover:shadow-md flex flex-col justify-between transition-all duration-200 ease-out hover:scale-105 active:scale-[0.99] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <span className="font-bold text-slate-600 group-hover:text-amber-700 text-[11px] inline-flex items-center justify-center gap-1 transition-colors">
              <span>Beklenen Çıkışlar</span>
              <ArrowRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
            </span>
            <div className="my-2">
              <div className="text-3xl font-extrabold text-amber-500 leading-none font-mono tabular-nums">
                {stats.expectedDepartures}
              </div>
              <div className="text-[11px] font-semibold text-slate-400 mt-1">Odalar</div>
            </div>
            <div className="pt-1.5 border-t border-slate-100 text-[11px] font-bold text-slate-600 w-full">
              Ayrılan: {stats.departedToday} Oda
            </div>
          </button>

          {/* Kart 4: Gün Sonu Tahmini -> END OF DAY */}
          <button
            type="button"
            onClick={() => onNavigateModule?.("END_OF_DAY")}
            title="END OF DAY modülüne git"
            className="group bg-[var(--pms-card-bg)] border border-slate-300 hover:border-emerald-500 rounded-[var(--pms-radius)] p-3.5 text-center shadow-2xs hover:shadow-md flex flex-col justify-between transition-all duration-200 ease-out hover:scale-105 active:scale-[0.99] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <span className="font-bold text-slate-600 group-hover:text-emerald-700 text-[11px] inline-flex items-center justify-center gap-1 transition-colors">
              <span>Gün Sonu</span>
              <ArrowRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
            </span>
            <div className="my-2">
              <div className="text-3xl font-extrabold text-slate-800 leading-none font-mono tabular-nums">
                {stats.endOfDayOccupied}
              </div>
              <div className="text-[11px] font-semibold text-slate-400 mt-1">Odalar</div>
            </div>
            <div className="pt-1.5 border-t border-slate-100 text-[11px] font-bold text-emerald-700 w-full">
              Hedef Doluluk: {stats.pct(stats.endOfDayOccupied)}
            </div>
          </button>
        </div>

        {/* ROOM STATUS SUMMARY WIDGET (INHOUSE / DUE OUT / AVAILABLE / OOO-CTS + KATEGORİ TOOLTIP) */}
        <RoomStatusSummaryWidget
          rooms={rooms}
          reservations={reservations}
          categories={categories}
          systemToday={systemToday}
        />

        {/* 2. ORTA BÖLÜM: ŞİMDİKİ DURUM TABLOSU + ODA DURUMU PASTA GRAFİKLERİ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Sol: Şimdiki Durum Tablosu */}
          <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs transition-colors">
            <h3 className="font-extrabold text-slate-800 text-xs mb-3 pb-2 border-b border-slate-200">
              Şimdiki Durum
            </h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 text-[11px] border-b border-slate-100">
                  <th className="text-left font-semibold pb-1.5">Durum Kalemi</th>
                  <th className="text-right font-semibold pb-1.5">Oda</th>
                  <th className="text-right font-semibold pb-1.5">Yüzde</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="py-2">Sabahki Durum</td>
                  <td className="py-2 text-right font-bold font-mono tabular-nums">
                    {stats.morningOccupied}
                  </td>
                  <td className="py-2 text-right font-semibold font-mono tabular-nums">
                    {stats.pct(stats.morningOccupied)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2">Gerçekleşen Gelişler</td>
                  <td className="py-2 text-right font-bold text-emerald-700 font-mono tabular-nums">
                    +{stats.realizedArrivals}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {stats.pct(stats.realizedArrivals)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2">Bugün Ayrılmış Odalar</td>
                  <td className="py-2 text-right font-bold text-rose-600 font-mono tabular-nums">
                    -{stats.departedToday}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {stats.pct(stats.departedToday)}
                  </td>
                </tr>
                <tr className="bg-sky-50/70 font-extrabold text-slate-900">
                  <td className="py-2 px-1">Şimdiki Durum</td>
                  <td className="py-2 text-right font-mono tabular-nums">{stats.inhouseNow}</td>
                  <td className="py-2 px-1 text-right font-mono tabular-nums">
                    {stats.pct(stats.inhouseNow)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2">Beklenen Gelişler</td>
                  <td className="py-2 text-right font-bold font-mono tabular-nums">
                    {stats.expectedArrivals}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {stats.pct(stats.expectedArrivals)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2">Beklenen Çıkışlar</td>
                  <td className="py-2 text-right font-bold font-mono tabular-nums">
                    {stats.expectedDepartures}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {stats.pct(stats.expectedDepartures)}
                  </td>
                </tr>
                <tr className="bg-slate-100 font-extrabold text-slate-900">
                  <td className="py-2 px-1">Gün Sonu</td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {stats.endOfDayOccupied}
                  </td>
                  <td className="py-2 px-1 text-right font-mono tabular-nums">
                    {stats.pct(stats.endOfDayOccupied)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Sağ: Oda Durumu & Temizlik Pasta Grafikleri */}
          <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs flex flex-col justify-between gap-4 transition-colors">
            {/* Üst Grafik: Doluluk Dağılımı */}
            <div>
              <h3 className="font-extrabold text-slate-800 text-xs mb-2 pb-1.5 border-b border-slate-200 flex items-center gap-1.5">
                <PieChartIcon className="w-3.5 h-3.5 text-sky-600" />
                Oda Durumu ({totalRooms} Oda)
              </h3>
              <div className="flex items-center justify-around gap-3 pt-1">
                <div
                  className="w-24 h-24 rounded-full shrink-0 border border-slate-200 shadow-inner"
                  style={{
                    background: `conic-gradient(
                      #1e293b 0deg ${occDeg}deg,
                      #38bdf8 ${occDeg}deg ${occDeg + availDeg}deg,
                      #f43f5e ${occDeg + availDeg}deg 360deg
                    )`,
                  }}
                />
                <div className="flex flex-col gap-1.5 text-[11px] font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-xs bg-slate-800 inline-block" />
                    <span>Dolu Oda ({stats.inhouseNow})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-xs bg-sky-400 inline-block" />
                    <span>Müsait Oda ({stats.availableCleanCount})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-xs bg-rose-500 inline-block" />
                    <span>Blokajlı / OOO ({stats.blockedCount})</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Alt Grafik: Temizlik Durumu */}
            <div className="pt-2 border-t border-slate-100">
              <h4 className="font-bold text-slate-700 text-[11px] mb-2 text-center">
                Temizlik & Bakım Durumu
              </h4>
              <div className="flex items-center justify-around gap-3">
                <div
                  className="w-24 h-24 rounded-full shrink-0 border border-slate-200 shadow-inner"
                  style={{
                    background: `conic-gradient(
                      #10b981 0deg ${cleanDeg}deg,
                      #f59e0b ${cleanDeg}deg ${cleanDeg + dirtyDeg}deg,
                      #94a3b8 ${cleanDeg + dirtyDeg}deg 360deg
                    )`,
                  }}
                />
                <div className="flex flex-col gap-1.5 text-[11px] font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-xs bg-emerald-500 inline-block" />
                    <span>Clean ({stats.cleanRoomsCount})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-xs bg-amber-500 inline-block" />
                    <span>Dirty ({stats.dirtyRoomsCount})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-xs bg-slate-400 inline-block" />
                    <span>Out of Order / Closed ({stats.blockedCount})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3. ALT BÖLÜM: 10 GÜNLÜK MÜSAİTLİK, DOLULUK & PROJEKSİYON GELİRİ FORECAST */}
        <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs flex flex-col gap-3 transition-colors">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
            <h3 className="font-extrabold text-slate-800 text-xs flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-sky-600" />
              10 Günlük Forecast — Müsaitlik, Doluluk & Tahmini Gelir
            </h3>
            <div className="flex items-center gap-3 text-[11px] font-semibold">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-sky-400 rounded-xs inline-block" /> Dolu Oda
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-amber-200 border border-amber-400 rounded-xs inline-block" />{" "}
                Müsait Oda
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-slate-500 rounded-xs inline-block" /> Blokaj
              </span>
            </div>
          </div>

          {/* 10 Günlük Projeksiyon Gelir Özeti (Kategori tarifeleri değiştikçe canlı güncellenir) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
            <div className="p-2.5 rounded-md bg-sky-50/70 border border-sky-200 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-sky-900">
                  Dolu Oda Gelir Projeksiyonu (10G)
                </div>
                <div className="text-sm font-extrabold text-sky-800 font-mono tabular-nums mt-0.5">
                  {forecastTotals.occupiedRevenue.toLocaleString("tr-TR")} TL
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-sky-700 tabular-nums">
                {forecastTotals.occupiedNights} Gece
              </span>
            </div>

            <div className="p-2.5 rounded-md bg-amber-50/70 border border-amber-200 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-amber-900">
                  Müsait Oda Potansiyeli (10G)
                </div>
                <div className="text-sm font-extrabold text-amber-950 font-mono tabular-nums mt-0.5">
                  {forecastTotals.availableRevenue.toLocaleString("tr-TR")} TL
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-amber-800 tabular-nums">
                {forecastTotals.availableNights} Boş Gece
              </span>
            </div>

            <div className="p-2.5 rounded-md bg-emerald-50/70 border border-emerald-200 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold text-emerald-900">
                  Toplam Kapasite Projeksiyonu (10G)
                </div>
                <div className="text-sm font-extrabold text-emerald-800 font-mono tabular-nums mt-0.5">
                  {forecastTotals.totalPotentialRevenue.toLocaleString("tr-TR")} TL
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-emerald-700 tabular-nums">
                ADR: {forecastTotals.weightedAdr.toLocaleString("tr-TR")} TL
              </span>
            </div>
          </div>

          <div className="grid grid-cols-10 gap-2 items-end pt-3 px-1">
            {forecast10Days.map((day) => {
              const occPct = (day.occupied / totalRooms) * 100;
              const availPct = (day.available / totalRooms) * 100;
              const blkPct = (day.blocked / totalRooms) * 100;

              return (
                <div key={day.date} className="flex flex-col items-center justify-end gap-1">
                  <div className="w-full max-w-9 flex flex-col-reverse rounded-t overflow-hidden border border-slate-300 h-32 bg-slate-50">
                    {/* Dolu Oda Çubuğu */}
                    {day.occupied > 0 && (
                      <div
                        style={{ height: `${occPct}%` }}
                        className="bg-sky-400 text-slate-950 font-extrabold text-[10px] flex items-center justify-center"
                        title={`Dolu: ${day.occupied} Oda · ${day.occupiedRevenue.toLocaleString("tr-TR")} TL`}
                      >
                        {day.occupied}
                      </div>
                    )}
                    {/* Müsait Oda Çubuğu */}
                    {day.available > 0 && (
                      <div
                        style={{ height: `${availPct}%` }}
                        className="bg-amber-200 text-amber-950 font-bold text-[10px] flex items-center justify-center"
                        title={`Müsait: ${day.available} Oda · ${day.availableRevenue.toLocaleString("tr-TR")} TL`}
                      >
                        {day.available}
                      </div>
                    )}
                    {/* Blokajlı Oda Çubuğu */}
                    {day.blocked > 0 && (
                      <div
                        style={{ height: `${blkPct}%` }}
                        className="bg-slate-600 text-white font-bold text-[9px] flex items-center justify-center"
                        title={`Blokaj: ${day.blocked} Oda`}
                      >
                        {day.blocked}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] font-bold text-slate-700">{day.label}</span>
                  <div
                    className="text-center font-mono tabular-nums leading-tight"
                    title={`Dolu Gelir: ${day.occupiedRevenue.toLocaleString("tr-TR")} TL | Toplam Potansiyel: ${day.totalPotentialRevenue.toLocaleString("tr-TR")} TL`}
                  >
                    <div className="text-[10px] font-extrabold text-sky-700">
                      {formatCompactTL(day.occupiedRevenue)} ₺
                    </div>
                    <div className="text-[9px] font-semibold text-slate-400">
                      /{formatCompactTL(day.totalPotentialRevenue)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ====================================================================
          SAĞ YAN BİLGİ SÜTUNU (3 SÜTUN: TAKVİM + DÖVİZ KURLARI + KATEGORİLER)
         ==================================================================== */}
      <div className="lg:col-span-3 flex flex-col gap-4">
        {/* 1. Takvim Kartı */}
        <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 text-center shadow-2xs transition-colors">
          <div className="flex items-center justify-center gap-1 text-slate-500 font-semibold capitalize">
            <CalendarDays className="w-3.5 h-3.5 text-sky-600" />
            <span>{monthName}</span>
          </div>
          <div className="text-4xl font-extrabold text-slate-800 my-1 font-mono tabular-nums">
            {dayNumber}
          </div>
          <div className="text-xs font-semibold text-slate-400 font-mono">{yearNumber}</div>
        </div>

        {/* 2. TCMB Döviz Kurları Kutusu (Alış / Satış + Hesaplama Kuru Seçimi) */}
        <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-3.5 shadow-2xs text-xs transition-colors">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
            <div>
              <span className="font-extrabold text-slate-800 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                <span>TCMB Döviz Kurları</span>
                {ratesMeta?.source && (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-extrabold text-[9px]">
                    {ratesMeta.source}
                  </span>
                )}
              </span>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Bülten: {exchangeState?.bulletinDate || ratesMeta?.bulletinDate || "—"}
              </span>
            </div>

            {onRefreshTcmbRates ? (
              <button
                type="button"
                onClick={() => void onRefreshTcmbRates()}
                disabled={isFetchingRates}
                title="TCMB kurlarını şimdi manuel güncelle"
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3 h-3 ${isFetchingRates ? "animate-spin text-sky-600" : ""}`}
                />
                <span>{isFetchingRates ? "Çekiliyor" : "Güncelle"}</span>
              </button>
            ) : (
              <RefreshCw className="w-3 h-3 text-slate-400" />
            )}
          </div>

          {/* İşlem Baz Kuru Seçimi (Alış / Satış) */}
          <div className="flex items-center justify-between mb-2 bg-slate-50 p-1.5 rounded border border-slate-200 text-[10px]">
            <span className="font-bold text-slate-600">Hesaplama Kuru:</span>
            <select
              value={activeRateType}
              onChange={(e) => {
                const nextType = e.target.value as TcmbRateType;
                if (onChangeActiveRateType) {
                  void onChangeActiveRateType(nextType);
                }
              }}
              aria-label="Hesaplama Kuru Tipi"
              className="font-extrabold text-sky-800 bg-transparent focus:outline-none cursor-pointer"
            >
              <option value="FOREX_BUYING">Döviz Alış (ForexBuying)</option>
              <option value="FOREX_SELLING">Döviz Satış (ForexSelling)</option>
            </select>
          </div>

          {/* Kur Tablosu */}
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="text-left pb-1">Döviz</th>
                <th
                  className={`text-right pb-1 ${
                    activeRateType === "FOREX_BUYING" ? "text-emerald-700" : ""
                  }`}
                >
                  Alış
                </th>
                <th
                  className={`text-right pb-1 ${
                    activeRateType === "FOREX_SELLING" ? "text-emerald-700" : ""
                  }`}
                >
                  Satış
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
              {(["USD", "EUR", "GBP"] as const).map((code) => {
                const item = effectiveTcmbTable[code];
                return (
                  <tr key={code}>
                    <td className="py-1.5 font-sans font-bold text-slate-800">{code}</td>
                    <td
                      className={`py-1.5 text-right ${
                        activeRateType === "FOREX_BUYING"
                          ? "font-extrabold text-emerald-800"
                          : "font-semibold text-slate-600"
                      }`}
                    >
                      {item.forexBuying.toFixed(4)}
                    </td>
                    <td
                      className={`py-1.5 text-right ${
                        activeRateType === "FOREX_SELLING"
                          ? "font-extrabold text-emerald-800"
                          : "font-semibold text-slate-700"
                      }`}
                    >
                      {item.forexSelling.toFixed(4)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 3. Oda Kategorileri Kapasite, Günlük Tarife & Daily Rate History */}
        <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs flex-1 flex flex-col gap-2.5 transition-colors">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
            <h3 className="font-extrabold text-slate-800 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-sky-600" />
              <span>Kategori Ayarları</span>
            </h3>
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded border border-slate-200">
              <button
                type="button"
                onClick={() => setRatePanelTab("RATES")}
                className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                  ratePanelTab === "RATES"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Tarifeler
              </button>
              <button
                type="button"
                onClick={() => {
                  categories.forEach((cat) => commitRateAudit(cat));
                  setRatePanelTab("HISTORY");
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                  ratePanelTab === "HISTORY"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <History className="w-2.5 h-2.5" />
                <span>Daily Rate History ({effectiveLogs.length})</span>
              </button>
            </div>
          </div>

          {ratePanelTab === "RATES" ? (
            <div className="flex flex-col gap-2.5">
              {categories.map((cat) => {
                const totalInCat = rooms.filter((r) => r.categoryId === cat.id).length;
                const occInCat = reservations.filter(
                  (r) => r.categoryId === cat.id && r.lifecycle === "INHOUSE"
                ).length;
                const currentRate = getEffectiveRate(cat);

                return (
                  <div
                    key={cat.id}
                    className="flex flex-col gap-1 pb-2 border-b border-slate-100 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between text-[11px] gap-2">
                      <span className="font-semibold text-slate-700 truncate">{cat.name}</span>
                      <span className="font-extrabold text-slate-900 font-mono tabular-nums shrink-0">
                        {occInCat}/{totalInCat}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          style={{
                            width: totalInCat > 0 ? `${(occInCat / totalInCat) * 100}%` : "0%",
                          }}
                          className="h-full bg-sky-500 rounded-full"
                        />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <input
                          type="number"
                          min={0}
                          step={100}
                          value={currentRate}
                          onFocus={() => handleRateFocus(cat)}
                          onChange={(e) => handleRateChange(cat.id, e.target.value)}
                          onBlur={() => commitRateAudit(cat)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              commitRateAudit(cat);
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                          aria-label={`${cat.name} Günlük Varsayılan Tarife`}
                          className="w-20 text-right font-mono font-bold text-[11px] text-slate-900 bg-slate-50 border border-slate-300 rounded px-1.5 py-0.5 focus:bg-white focus:outline-none focus:border-sky-600 tabular-nums"
                        />
                        <span className="text-[10px] font-bold text-slate-500">TL</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <select
                value={historyCategoryFilter}
                onChange={(e) => setHistoryCategoryFilter(e.target.value)}
                aria-label="Tarife Geçmişi Kategori Filtresi"
                className="w-full text-[11px] font-bold text-slate-700 bg-slate-50 border border-slate-300 rounded px-2 py-1 focus:outline-none focus:border-sky-600"
              >
                <option value="ALL">Tüm Kategoriler ({effectiveLogs.length})</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>

              {filteredRateLogs.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-[11px] font-medium">
                  Bu kategori için henüz tarife değişikliği kaydı bulunmuyor.
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-0.5">
                  {filteredRateLogs.map((entry) => {
                    const diff = entry.newRate - entry.oldRate;
                    return (
                      <div
                        key={entry.id}
                        className="p-2 rounded border border-slate-200 bg-slate-50/70 flex flex-col gap-1 text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-extrabold text-slate-900 truncate">
                            {entry.categoryName}
                          </span>
                          <span
                            className={`font-mono font-extrabold tabular-nums shrink-0 ${
                              diff > 0 ? "text-emerald-700" : "text-rose-700"
                            }`}
                          >
                            {diff > 0 ? "+" : ""}
                            {diff.toLocaleString("tr-TR")} TL
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 font-mono tabular-nums text-[11px]">
                          <span className="text-slate-500 line-through">
                            {entry.oldRate.toLocaleString("tr-TR")} TL
                          </span>
                          <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-extrabold text-sky-800">
                            {entry.newRate.toLocaleString("tr-TR")} TL
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/70 text-[10px] text-slate-500">
                          <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                            <UserCheck className="w-3 h-3 text-sky-600" />
                            <span>{entry.changedBy}</span>
                          </span>
                          <span className="font-mono tabular-nums">{entry.timestamp}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
