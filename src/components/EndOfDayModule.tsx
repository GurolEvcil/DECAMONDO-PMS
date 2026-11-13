"use client";

import React, { useMemo } from "react";
import {
  Moon,
  CalendarCheck2,
  ArrowRight,
  PieChart as PieChartIcon,
  CheckCircle2,
  Clock,
  AlertTriangle,
  History,
  TrendingUp,
  BedDouble,
  LogIn,
  LogOut,
  Sparkles,
  FileCheck2,
  Loader2,
  Tag,
} from "lucide-react";

export interface EndOfDayCategorySummary {
  categoryId: string;
  categoryName: string;
  totalRooms: number;
  occupiedRooms: number;
  rate: number;
}

export interface EndOfDayGuestSummary {
  resCode: string;
  roomNumber: string | null;
  guestName: string;
  lifecycle: "CONFIRMED" | "INHOUSE" | "CHECKED_OUT" | "CANCELLED";
  checkIn: string;
  checkOut: string;
  totalAmount: number;
  paidAmount: number;
  extraChargesTotal: number;
}

export interface EndOfDayReport {
  id: string;
  businessDate: string;
  nextBusinessDate: string;
  closedAt: string;
  closedBy: string;
  totalRooms: number;
  occupiedRooms: number;
  occupancyRate: number;
  availableRooms: number;
  blockedRooms: number;
  cleanRooms: number;
  dirtyRooms: number;
  arrivalsRealized: number;
  arrivalsPending: number;
  departuresCompleted: number;
  departuresPending: number;
  roomRevenue: number;
  extraChargesRevenue: number;
  collectedPayments: number;
  pendingBalance: number;
  adr: number;
  revPar: number;
  categoryBreakdown: EndOfDayCategorySummary[];
  guestSnapshots: EndOfDayGuestSummary[];
}

export interface EndOfDayRoomInput {
  roomNumber: string;
  floor: number;
  categoryId: string;
  physicalStatus: "AVAILABLE" | "OUT_OF_ORDER" | "CLOSED_TO_SALES";
  isDirty?: boolean;
}

export interface EndOfDayReservationInput {
  id: string;
  resCode: string;
  roomNumber: string | null;
  firstName: string;
  lastName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  categoryId: string;
  paidAmount: number;
  totalAmount: number;
  lifecycle: "CONFIRMED" | "INHOUSE" | "CHECKED_OUT" | "CANCELLED";
  extraCharges?: { amount: number }[];
}

export interface EndOfDayCategoryInput {
  id: string;
  name: string;
  defaultRate: number;
}

interface EndOfDayModuleProps {
  rooms: EndOfDayRoomInput[];
  reservations: EndOfDayReservationInput[];
  categories: EndOfDayCategoryInput[];
  systemToday: string;
  nextBusinessDate: string;
  eodReports: EndOfDayReport[];
  selectedReportId: string | null;
  onSelectReport: (reportId: string | null) => void;
  onExecuteEndOfDay: () => Promise<void>;
  isClosingDay: boolean;
}

function formatTrDate(isoDate: string): string {
  if (!isoDate) return "";
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const [y, m, d] = isoDate.split("-");
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export function buildEndOfDaySnapshot(params: {
  id: string;
  businessDate: string;
  nextBusinessDate: string;
  closedAt: string;
  closedBy: string;
  rooms: EndOfDayRoomInput[];
  reservations: EndOfDayReservationInput[];
  categories: EndOfDayCategoryInput[];
}): EndOfDayReport {
  const {
    id,
    businessDate,
    nextBusinessDate,
    closedAt,
    closedBy,
    rooms,
    reservations,
    categories,
  } = params;

  const totalRooms = rooms.length || 20;
  const inhouseList = reservations.filter((r) => r.lifecycle === "INHOUSE");
  const occupiedRooms = inhouseList.length;
  const occupancyRate = Number(((occupiedRooms / Math.max(1, totalRooms)) * 100).toFixed(1));

  const blockedRooms = rooms.filter(
    (rm) => rm.physicalStatus === "OUT_OF_ORDER" || rm.physicalStatus === "CLOSED_TO_SALES"
  ).length;
  const availableRooms = Math.max(0, totalRooms - occupiedRooms - blockedRooms);
  const dirtyRooms = rooms.filter((rm) => Boolean(rm.isDirty)).length;
  const cleanRooms = Math.max(0, totalRooms - dirtyRooms - blockedRooms);

  const arrivalsRealized = reservations.filter(
    (r) => r.checkIn === businessDate && r.lifecycle === "INHOUSE"
  ).length;
  const arrivalsPending = reservations.filter(
    (r) => r.checkIn <= businessDate && r.lifecycle === "CONFIRMED"
  ).length;

  const checkedOutToday = reservations.filter(
    (r) => r.checkOut === businessDate && r.lifecycle === "CHECKED_OUT"
  );
  const departuresCompleted = checkedOutToday.length;
  const departuresPending = inhouseList.filter((r) => r.checkOut <= businessDate).length;

  const catRateMap = new Map<string, number>();
  categories.forEach((c) => catRateMap.set(c.id, c.defaultRate || 0));

  let roomRevenue = 0;
  let extraChargesRevenue = 0;

  inhouseList.forEach((r) => {
    const extraSum = (r.extraCharges || []).reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
    const accommodationTotal = Math.max(0, (Number(r.totalAmount) || 0) - extraSum);
    const nightly =
      r.nights > 0
        ? Math.round(accommodationTotal / r.nights)
        : catRateMap.get(r.categoryId) || 0;
    roomRevenue += nightly;
    extraChargesRevenue += extraSum;
  });

  checkedOutToday.forEach((r) => {
    const extraSum = (r.extraCharges || []).reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
    extraChargesRevenue += extraSum;
  });

  const relevantForMoney = reservations.filter(
    (r) =>
      r.lifecycle === "INHOUSE" ||
      (r.lifecycle === "CHECKED_OUT" && r.checkOut === businessDate)
  );
  const collectedPayments = relevantForMoney.reduce(
    (sum, r) => sum + (Number(r.paidAmount) || 0),
    0
  );
  const pendingBalance = relevantForMoney.reduce(
    (sum, r) => sum + Math.max(0, (Number(r.totalAmount) || 0) - (Number(r.paidAmount) || 0)),
    0
  );

  const adr = occupiedRooms > 0 ? Math.round(roomRevenue / occupiedRooms) : 0;
  const revPar = totalRooms > 0 ? Math.round(roomRevenue / totalRooms) : 0;

  const categoryBreakdown: EndOfDayCategorySummary[] = categories.slice(0, 20).map((cat) => ({
    categoryId: cat.id.slice(0, 32),
    categoryName: cat.name.slice(0, 80),
    totalRooms: rooms.filter((rm) => rm.categoryId === cat.id).length,
    occupiedRooms: inhouseList.filter((r) => r.categoryId === cat.id).length,
    rate: Number(cat.defaultRate) || 0,
  }));

  const activeOrTodayRows = reservations
    .filter(
      (r) =>
        r.lifecycle === "INHOUSE" ||
        (r.lifecycle === "CONFIRMED" && r.checkIn <= businessDate) ||
        (r.lifecycle === "CHECKED_OUT" && r.checkOut === businessDate)
    )
    .slice(0, 100);

  const guestSnapshots: EndOfDayGuestSummary[] = activeOrTodayRows.map((r) => {
    const extraSum = (r.extraCharges || []).reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
    return {
      resCode: r.resCode.slice(0, 32),
      roomNumber: r.roomNumber ? r.roomNumber.slice(0, 16) : null,
      guestName: `${r.firstName} ${r.lastName}`.trim().slice(0, 120) || "Misafir",
      lifecycle: r.lifecycle,
      checkIn: r.checkIn.slice(0, 10),
      checkOut: r.checkOut.slice(0, 10),
      totalAmount: Number(r.totalAmount) || 0,
      paidAmount: Number(r.paidAmount) || 0,
      extraChargesTotal: extraSum,
    };
  });

  return {
    id,
    businessDate,
    nextBusinessDate,
    closedAt,
    closedBy,
    totalRooms,
    occupiedRooms,
    occupancyRate,
    availableRooms,
    blockedRooms,
    cleanRooms,
    dirtyRooms,
    arrivalsRealized,
    arrivalsPending,
    departuresCompleted,
    departuresPending,
    roomRevenue,
    extraChargesRevenue,
    collectedPayments,
    pendingBalance,
    adr,
    revPar,
    categoryBreakdown,
    guestSnapshots,
  };
}

export default function EndOfDayModule({
  rooms,
  reservations,
  categories,
  systemToday,
  nextBusinessDate,
  eodReports,
  selectedReportId,
  onSelectReport,
  onExecuteEndOfDay,
  isClosingDay,
}: EndOfDayModuleProps) {
  const livePreview = useMemo(
    () =>
      buildEndOfDaySnapshot({
        id: `PREVIEW-${systemToday}`,
        businessDate: systemToday,
        nextBusinessDate,
        closedAt: "Henüz Kapatılmadı",
        closedBy: "Aktif Oturum",
        rooms,
        reservations,
        categories,
      }),
    [rooms, reservations, categories, systemToday, nextBusinessDate]
  );

  const selectedReport = useMemo(
    () => eodReports.find((r) => r.id === selectedReportId) || null,
    [eodReports, selectedReportId]
  );

  const displayedSummary = selectedReport || livePreview;
  const isViewingArchived = Boolean(selectedReport);

  const totalRoomsSafe = Math.max(1, displayedSummary.totalRooms);
  const pct = (val: number) => `%${((val / totalRoomsSafe) * 100).toFixed(1)}`;
  const totalRevenueDay = displayedSummary.roomRevenue + displayedSummary.extraChargesRevenue;

  const totalPie1 = Math.max(
    1,
    displayedSummary.occupiedRooms + displayedSummary.availableRooms + displayedSummary.blockedRooms
  );
  const occDeg = (displayedSummary.occupiedRooms / totalPie1) * 360;
  const availDeg = (displayedSummary.availableRooms / totalPie1) * 360;

  const totalPie2 = Math.max(
    1,
    displayedSummary.cleanRooms + displayedSummary.dirtyRooms + displayedSummary.blockedRooms
  );
  const cleanDeg = (displayedSummary.cleanRooms / totalPie2) * 360;
  const dirtyDeg = (displayedSummary.dirtyRooms / totalPie2) * 360;

  return (
    <div className="max-w-7xl mx-auto w-full flex flex-col gap-4 text-xs">
      {/* ====================================================================
          1. ÜST KONTROL BARI: AKTİF GÜN KAPAMA & END OF DAY BUTONU
         ==================================================================== */}
      <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--pms-radius)] bg-slate-900 text-white font-extrabold text-xs tracking-wide">
              <Moon className="w-3.5 h-3.5 text-amber-400" />
              <span>END OF DAY (GÜN SONU KAPANIŞI)</span>
            </span>

            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--pms-radius)] bg-sky-50 border border-sky-200 text-sky-900 font-bold">
              <span>Aktif PMS Günü:</span>
              <span className="font-mono font-extrabold">{formatTrDate(systemToday)}</span>
            </span>

            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />

            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--pms-radius)] bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold">
              <span>Sonraki Gün:</span>
              <span className="font-mono font-extrabold">{formatTrDate(nextBusinessDate)}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 pt-0.5">
            <span className="inline-flex items-center gap-1">
              <BedDouble className="w-3.5 h-3.5 text-sky-600" />
              Konaklayan: <b className="text-slate-900">{livePreview.occupiedRooms}</b>
            </span>
            <span className="inline-flex items-center gap-1">
              <LogIn className="w-3.5 h-3.5 text-rose-600" />
              Bekleyen Giriş: <b className="text-slate-900">{livePreview.arrivalsPending}</b>
            </span>
            <span className="inline-flex items-center gap-1">
              <LogOut className="w-3.5 h-3.5 text-amber-600" />
              Bekleyen Çıkış: <b className="text-slate-900">{livePreview.departuresPending}</b>
            </span>
            <span className="inline-flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Kirli Oda: <b className="text-slate-900">{livePreview.dirtyRooms}</b>
            </span>
            {livePreview.pendingBalance > 0 && (
              <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                <AlertTriangle className="w-3.5 h-3.5" />
                Açık Bakiye: {livePreview.pendingBalance.toLocaleString("tr-TR")} TL
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {isViewingArchived && (
            <button
              type="button"
              onClick={() => onSelectReport(null)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--pms-radius)] border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold cursor-pointer transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-sky-600" />
              <span>Aktif Günün Canlı Özetine Dön</span>
            </button>
          )}

          <button
            type="button"
            disabled={isClosingDay}
            onClick={() => void onExecuteEndOfDay()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[var(--pms-radius)] bg-[var(--pms-accent)] hover:opacity-95 disabled:opacity-60 text-white font-extrabold text-xs tracking-wide shadow-sm cursor-pointer transition"
          >
            {isClosingDay ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CalendarCheck2 className="w-4 h-4" />
            )}
            <span>{isClosingDay ? "GÜN KAPATILIYOR..." : "END OF DAY"}</span>
          </button>
        </div>
      </div>

      {/* ====================================================================
          2. GERİYE DÖNÜK KAPATILAN GÜNLER ARŞİVİ
         ==================================================================== */}
      <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-3.5 shadow-2xs flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-1.5 font-extrabold text-slate-800">
            <History className="w-4 h-4 text-sky-600" />
            <span>Kapatılan Günler & Geriye Dönük Gün Sonu Arşivi ({eodReports.length})</span>
          </div>
          <span className="text-[11px] text-slate-500">
            Geçmiş gün özetini incelemek için tarih kartına tıklayın
          </span>
        </div>

        {eodReports.length === 0 ? (
          <div className="py-4 text-center text-slate-400 text-xs">
            Henüz kapatılmış bir PMS günü bulunmuyor. İlk kapanışı yapmak için sağ üstteki{" "}
            <b className="text-slate-600">END OF DAY</b> butonuna basın.
          </div>
        ) : (
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => onSelectReport(null)}
              className={`shrink-0 px-3 py-2 rounded-[var(--pms-radius)] border text-left transition cursor-pointer min-w-[170px] ${
                !isViewingArchived
                  ? "bg-sky-50 border-sky-500 ring-1 ring-sky-400"
                  : "bg-slate-50 border-slate-200 hover:bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase text-sky-700">
                  AKTİF GÜN (CANLI)
                </span>
                <Clock className="w-3 h-3 text-sky-600" />
              </div>
              <div className="font-mono font-extrabold text-sm text-slate-900 mt-0.5">
                {formatTrDate(systemToday)}
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5 font-mono tabular-nums">
                %{livePreview.occupancyRate} · {livePreview.occupiedRooms}/{livePreview.totalRooms} Oda
              </div>
            </button>

            {eodReports.map((rep) => {
              const isSelected = selectedReportId === rep.id;
              const repTotalRev = rep.roomRevenue + rep.extraChargesRevenue;
              return (
                <button
                  type="button"
                  key={rep.id}
                  onClick={() => onSelectReport(rep.id)}
                  className={`shrink-0 px-3 py-2 rounded-[var(--pms-radius)] border text-left transition cursor-pointer min-w-[195px] ${
                    isSelected
                      ? "bg-emerald-50 border-emerald-500 ring-1 ring-emerald-400"
                      : "bg-slate-50 border-slate-200 hover:bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-extrabold uppercase text-emerald-700">
                      KAPATILDI
                    </span>
                    <FileCheck2 className="w-3 h-3 text-emerald-600" />
                  </div>
                  <div className="font-mono font-extrabold text-sm text-slate-900 mt-0.5">
                    {formatTrDate(rep.businessDate)}
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 font-mono tabular-nums">
                    %{rep.occupancyRate} · {repTotalRev.toLocaleString("tr-TR")} TL
                  </div>
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">{rep.closedAt}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ====================================================================
          3. DASHBOARD BENZERİ GÜN ÖZETİ BAŞLIK BANDI
         ==================================================================== */}
      <div
        className={`rounded-[var(--pms-radius)] border px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 ${
          isViewingArchived
            ? "bg-emerald-50 border-emerald-300 text-emerald-950"
            : "bg-sky-50 border-sky-200 text-sky-950"
        }`}
      >
        <div className="flex items-center gap-2 font-extrabold text-xs">
          {isViewingArchived ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <Clock className="w-4 h-4 text-sky-600 shrink-0" />
          )}
          <span>
            {isViewingArchived
              ? `KAPATILMIŞ GÜN ÖZETİ — ${formatTrDate(displayedSummary.businessDate)}`
              : `AKTİF GÜN ÖNİZLEMESİ (HENÜZ KAPATILMADI) — ${formatTrDate(displayedSummary.businessDate)}`}
          </span>
        </div>
        <div className="text-[11px] font-semibold flex items-center gap-3 flex-wrap">
          <span>
            Kapatan: <b>{displayedSummary.closedBy}</b>
          </span>
          <span className="font-mono">{displayedSummary.closedAt}</span>
          {isViewingArchived && (
            <span className="px-2 py-0.5 rounded bg-emerald-700 text-white font-bold">
              Sonraki Aktif Gün: {formatTrDate(displayedSummary.nextBusinessDate)}
            </span>
          )}
        </div>
      </div>

      {/* ====================================================================
          4. DASHBOARD BENZERİ 4 BÜYÜK KPI KARTI
         ==================================================================== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-3.5 text-center shadow-2xs flex flex-col justify-between">
          <span className="font-bold text-slate-600 text-[11px]">Konaklayan Odalar</span>
          <div className="my-2">
            <div className="text-3xl font-extrabold text-sky-600 leading-none font-mono tabular-nums">
              {displayedSummary.occupiedRooms}
            </div>
            <div className="text-[11px] font-semibold text-slate-400 mt-1">
              / {displayedSummary.totalRooms} Oda
            </div>
          </div>
          <div className="pt-1.5 border-t border-slate-100 text-[11px] font-bold text-slate-600">
            Doluluk: %{displayedSummary.occupancyRate}
          </div>
        </div>

        <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-3.5 text-center shadow-2xs flex flex-col justify-between">
          <span className="font-bold text-slate-600 text-[11px]">Giriş İşlemleri</span>
          <div className="my-2">
            <div className="text-3xl font-extrabold text-emerald-600 leading-none font-mono tabular-nums">
              {displayedSummary.arrivalsRealized}
            </div>
            <div className="text-[11px] font-semibold text-slate-400 mt-1">Gerçekleşen</div>
          </div>
          <div className="pt-1.5 border-t border-slate-100 text-[11px] font-bold text-slate-600">
            Bekleyen Giriş: {displayedSummary.arrivalsPending} Oda
          </div>
        </div>

        <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-3.5 text-center shadow-2xs flex flex-col justify-between">
          <span className="font-bold text-slate-600 text-[11px]">Çıkış İşlemleri</span>
          <div className="my-2">
            <div className="text-3xl font-extrabold text-amber-500 leading-none font-mono tabular-nums">
              {displayedSummary.departuresCompleted}
            </div>
            <div className="text-[11px] font-semibold text-slate-400 mt-1">Tamamlanan</div>
          </div>
          <div className="pt-1.5 border-t border-slate-100 text-[11px] font-bold text-slate-600">
            Kalan Due Out: {displayedSummary.departuresPending} Oda
          </div>
        </div>

        <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-3.5 text-center shadow-2xs flex flex-col justify-between">
          <span className="font-bold text-slate-600 text-[11px]">Günlük Gelir (Oda + POST)</span>
          <div className="my-2">
            <div className="text-2xl font-extrabold text-slate-900 leading-none font-mono tabular-nums">
              {totalRevenueDay.toLocaleString("tr-TR")} TL
            </div>
            <div className="text-[11px] font-semibold text-slate-400 mt-1">
              ADR: {displayedSummary.adr.toLocaleString("tr-TR")} TL
            </div>
          </div>
          <div className="pt-1.5 border-t border-slate-100 text-[11px] font-bold text-emerald-700">
            RevPAR: {displayedSummary.revPar.toLocaleString("tr-TR")} TL
          </div>
        </div>
      </div>

      {/* ====================================================================
          5. ORTA BÖLÜM: DURUM/FİNANS TABLOSU + PASTA GRAFİKLERİ
         ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Sol: Gün Sonu Durum & Finans Tablosu */}
        <div className="lg:col-span-6 bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs">
          <h3 className="font-extrabold text-slate-800 text-xs mb-3 pb-2 border-b border-slate-200 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-sky-600" />
            <span>Gün Sonu Operasyon & Finans Özeti</span>
          </h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-[11px] border-b border-slate-100">
                <th className="text-left font-semibold pb-1.5">Kalem</th>
                <th className="text-right font-semibold pb-1.5">Değer</th>
                <th className="text-right font-semibold pb-1.5">Oran / Not</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              <tr className="bg-sky-50/70 font-extrabold text-slate-900">
                <td className="py-2 px-1">Dolu Oda (INHOUSE)</td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {displayedSummary.occupiedRooms} Oda
                </td>
                <td className="py-2 px-1 text-right font-mono tabular-nums">
                  {pct(displayedSummary.occupiedRooms)}
                </td>
              </tr>
              <tr>
                <td className="py-2">Müsait / Boş Oda</td>
                <td className="py-2 text-right font-bold font-mono tabular-nums">
                  {displayedSummary.availableRooms} Oda
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {pct(displayedSummary.availableRooms)}
                </td>
              </tr>
              <tr>
                <td className="py-2">Blokajlı (OOO / CTS)</td>
                <td className="py-2 text-right font-bold text-rose-600 font-mono tabular-nums">
                  {displayedSummary.blockedRooms} Oda
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {pct(displayedSummary.blockedRooms)}
                </td>
              </tr>
              <tr>
                <td className="py-2">Temiz / Kirli Odalar</td>
                <td className="py-2 text-right font-bold font-mono tabular-nums">
                  {displayedSummary.cleanRooms} / {displayedSummary.dirtyRooms}
                </td>
                <td className="py-2 text-right text-slate-500">Clean / Dirty</td>
              </tr>
              <tr>
                <td className="py-2">Konaklama Geliri (Günlük)</td>
                <td className="py-2 text-right font-bold text-slate-900 font-mono tabular-nums">
                  {displayedSummary.roomRevenue.toLocaleString("tr-TR")} TL
                </td>
                <td className="py-2 text-right text-slate-500">Oda Geliri</td>
              </tr>
              <tr>
                <td className="py-2">Ekstra POST Hizmetler</td>
                <td className="py-2 text-right font-bold text-sky-700 font-mono tabular-nums">
                  {displayedSummary.extraChargesRevenue.toLocaleString("tr-TR")} TL
                </td>
                <td className="py-2 text-right text-slate-500">Folio POST</td>
              </tr>
              <tr>
                <td className="py-2">Tahsil Edilen Ödemeler</td>
                <td className="py-2 text-right font-bold text-emerald-700 font-mono tabular-nums">
                  {displayedSummary.collectedPayments.toLocaleString("tr-TR")} TL
                </td>
                <td className="py-2 text-right text-emerald-700">Tahsilat</td>
              </tr>
              <tr className="bg-slate-100 font-extrabold text-slate-900">
                <td className="py-2 px-1">Açık / Kalan Bakiye</td>
                <td className="py-2 text-right font-mono tabular-nums text-amber-800">
                  {displayedSummary.pendingBalance.toLocaleString("tr-TR")} TL
                </td>
                <td className="py-2 px-1 text-right text-slate-600">Folyo Bakiyesi</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Sağ: Pasta Grafikler & Kategori Dağılımı */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Oda Durumu Pasta */}
            <div>
              <h3 className="font-extrabold text-slate-800 text-xs mb-2 pb-1.5 border-b border-slate-200 flex items-center gap-1.5">
                <PieChartIcon className="w-3.5 h-3.5 text-sky-600" />
                Oda Durumu
              </h3>
              <div className="flex items-center gap-3 pt-1">
                <div
                  className="w-20 h-20 rounded-full shrink-0 border border-slate-200 shadow-inner"
                  style={{
                    background: `conic-gradient(
                      #1e293b 0deg ${occDeg}deg,
                      #38bdf8 ${occDeg}deg ${occDeg + availDeg}deg,
                      #f43f5e ${occDeg + availDeg}deg 360deg
                    )`,
                  }}
                />
                <div className="flex flex-col gap-1 text-[11px] font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-slate-800 inline-block" />
                    <span>Dolu ({displayedSummary.occupiedRooms})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-sky-400 inline-block" />
                    <span>Müsait ({displayedSummary.availableRooms})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                    <span>Blokaj ({displayedSummary.blockedRooms})</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Temizlik Durumu Pasta */}
            <div>
              <h3 className="font-extrabold text-slate-800 text-xs mb-2 pb-1.5 border-b border-slate-200 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                Temizlik Durumu
              </h3>
              <div className="flex items-center gap-3 pt-1">
                <div
                  className="w-20 h-20 rounded-full shrink-0 border border-slate-200 shadow-inner"
                  style={{
                    background: `conic-gradient(
                      #10b981 0deg ${cleanDeg}deg,
                      #f59e0b ${cleanDeg}deg ${cleanDeg + dirtyDeg}deg,
                      #94a3b8 ${cleanDeg + dirtyDeg}deg 360deg
                    )`,
                  }}
                />
                <div className="flex flex-col gap-1 text-[11px] font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                    <span>Clean ({displayedSummary.cleanRooms})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block" />
                    <span>Dirty ({displayedSummary.dirtyRooms})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-slate-400 inline-block" />
                    <span>OOO/CTS ({displayedSummary.blockedRooms})</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Kategori Doluluk Çubukları */}
          <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs flex flex-col gap-2">
            <h3 className="font-extrabold text-slate-800 text-xs pb-1.5 border-b border-slate-200 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-sky-600" />
              Kategori Bazlı Gün Sonu Doluluğu
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              {displayedSummary.categoryBreakdown.map((cat) => (
                <div key={cat.categoryId} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-700 truncate">{cat.categoryName}</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums shrink-0">
                      {cat.occupiedRooms}/{cat.totalRooms}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      style={{
                        width:
                          cat.totalRooms > 0
                            ? `${Math.min(100, (cat.occupiedRooms / cat.totalRooms) * 100)}%`
                            : "0%",
                      }}
                      className="h-full bg-sky-500 rounded-full"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ====================================================================
          6. GÜN İÇİ KONAKLAMA & İŞLEM KAYITLARI SNAPSHOT TABLOSU
         ==================================================================== */}
      <div className="bg-[var(--pms-card-bg)] border border-slate-300 rounded-[var(--pms-radius)] p-4 shadow-2xs flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
          <h3 className="font-extrabold text-slate-800 text-xs">
            Gün Sonu Misafir & Folyo Kayıtları ({displayedSummary.guestSnapshots.length})
          </h3>
          <span className="text-[11px] text-slate-500">
            Kapanış anındaki aktif INHOUSE, gün içi CHECKED OUT ve bekleyen girişler
          </span>
        </div>

        {displayedSummary.guestSnapshots.length === 0 ? (
          <div className="py-6 text-center text-slate-400">Bu güne ait misafir hareketi kaydı yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200 bg-slate-50">
                  <th className="text-left py-2 px-2">PNR</th>
                  <th className="text-left py-2 px-2">Oda</th>
                  <th className="text-left py-2 px-2">Misafir</th>
                  <th className="text-left py-2 px-2">Durum</th>
                  <th className="text-left py-2 px-2">Tarih Aralığı</th>
                  <th className="text-right py-2 px-2">POST Ekstra</th>
                  <th className="text-right py-2 px-2">Toplam</th>
                  <th className="text-right py-2 px-2">Ödenen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayedSummary.guestSnapshots.map((g, idx) => (
                  <tr key={`${g.resCode}-${idx}`} className="hover:bg-slate-50/70">
                    <td className="py-2 px-2 font-mono font-bold text-slate-700">{g.resCode}</td>
                    <td className="py-2 px-2 font-mono font-bold text-slate-900">
                      {g.roomNumber || "—"}
                    </td>
                    <td className="py-2 px-2 font-bold text-slate-900">{g.guestName}</td>
                    <td className="py-2 px-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                          g.lifecycle === "INHOUSE"
                            ? "bg-sky-100 text-sky-900"
                            : g.lifecycle === "CHECKED_OUT"
                              ? "bg-slate-200 text-slate-700"
                              : "bg-amber-100 text-amber-900"
                        }`}
                      >
                        {g.lifecycle}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-slate-600 font-mono">
                      {formatTrDate(g.checkIn)} → {formatTrDate(g.checkOut)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-semibold text-sky-700 tabular-nums">
                      {g.extraChargesTotal.toLocaleString("tr-TR")} TL
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-slate-900 tabular-nums">
                      {g.totalAmount.toLocaleString("tr-TR")} TL
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-emerald-700 tabular-nums">
                      {g.paidAmount.toLocaleString("tr-TR")} TL
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
