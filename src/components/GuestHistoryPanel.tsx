import React, { useMemo, useState, useEffect } from "react";
import {
  Search,
  X,
  Users,
  Calendar,
  BedDouble,
  StickyNote,
  CheckCircle2,
  Clock,
  Eye,
  Wallet,
  Ban,
} from "lucide-react";
import type { Reservation, RoomCategory } from "../App";

interface GuestHistoryPanelProps {
  isOpen: boolean;
  initialQuery?: string;
  reservations: Reservation[];
  categories: RoomCategory[];
  onClose: () => void;
  onOpenReservationCard: (reservation: Reservation) => void;
}

type HistoryScope = "PAST_ONLY" | "ALL";

interface GuestAggregate {
  key: string;
  fullName: string;
  stays: Reservation[];
  pastStaysCount: number;
  totalNights: number;
  totalRevenue: number;
  totalPaid: number;
  previousNotes: {
    resId: string;
    resCode: string;
    roomNumber: string | null;
    checkIn: string;
    checkOut: string;
    note: string;
  }[];
  lastCheckOut: string;
}

function formatTrDate(isoDate: string): string {
  if (!isoDate) return "";
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const [y, m, d] = isoDate.split("-");
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

export default function GuestHistoryPanel({
  isOpen,
  initialQuery = "",
  reservations,
  categories,
  onClose,
  onOpenReservationCard,
}: GuestHistoryPanelProps) {
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [scope, setScope] = useState<HistoryScope>("PAST_ONLY");
  const [selectedGuestKey, setSelectedGuestKey] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm(initialQuery);
      setSelectedGuestKey(null);
    }
  }, [isOpen, initialQuery]);

  const getCategoryName = (catId: string) =>
    categories.find((c) => c.id === catId)?.name || "Tanımsız";

  const guestsList = useMemo(() => {
    const map = new Map<string, Reservation[]>();

    reservations.forEach((res) => {
      if (scope === "PAST_ONLY" && res.lifecycle !== "CHECKED_OUT") return;
      const fullName = `${res.firstName.trim()} ${res.lastName.trim()}`.toLocaleUpperCase("tr-TR");
      const existing = map.get(fullName) || [];
      existing.push(res);
      map.set(fullName, existing);
    });

    const q = searchTerm.trim().toLocaleLowerCase("tr-TR");
    const aggregated: GuestAggregate[] = [];

    map.forEach((stays, key) => {
      if (q && !key.toLocaleLowerCase("tr-TR").includes(q)) return;

      const sortedStays = [...stays].sort((a, b) => b.checkIn.localeCompare(a.checkIn));
      const pastStays = sortedStays.filter((s) => s.lifecycle === "CHECKED_OUT");
      const nonCancelledStays = sortedStays.filter((s) => s.lifecycle !== "CANCELLED");
      const totalNights = nonCancelledStays.reduce((acc, s) => acc + s.nights, 0);
      const totalRevenue = nonCancelledStays.reduce((acc, s) => acc + s.totalAmount, 0);
      const totalPaid = nonCancelledStays.reduce((acc, s) => acc + s.paidAmount, 0);

      const previousNotes = sortedStays
        .filter((s) => Boolean(s.notes && s.notes.trim()))
        .map((s) => ({
          resId: s.id,
          resCode: s.resCode,
          roomNumber: s.roomNumber,
          checkIn: s.checkIn,
          checkOut: s.checkOut,
          note: s.notes.trim(),
        }));

      aggregated.push({
        key,
        fullName: key,
        stays: sortedStays,
        pastStaysCount: pastStays.length,
        totalNights,
        totalRevenue,
        totalPaid,
        previousNotes,
        lastCheckOut: sortedStays[0]?.checkOut || "",
      });
    });

    return aggregated.sort((a, b) => {
      if (b.totalRevenue !== a.totalRevenue) return b.totalRevenue - a.totalRevenue;
      return a.fullName.localeCompare(b.fullName, "tr-TR");
    });
  }, [reservations, scope, searchTerm]);

  const activeGuest = useMemo(() => {
    if (guestsList.length === 0) return null;
    if (selectedGuestKey) {
      const match = guestsList.find((g) => g.key === selectedGuestKey);
      if (match) return match;
    }
    return guestsList[0];
  }, [guestsList, selectedGuestKey]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-slate-900/40 backdrop-blur-xs no-print"
      onClick={onClose}
    >
      <aside
        aria-label="Guest History"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-white h-full border-l border-slate-200 shadow-2xl flex flex-col"
      >
        {/* Başlık */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-4 h-4 text-sky-400" />
            <div>
              <h2 className="text-sm font-extrabold tracking-wide">Guest History</h2>
              <p className="text-[11px] text-slate-400">
                Geçmiş Rezervasyonlar, Toplam Gelir & Önceki Ziyaret Notları
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white cursor-pointer"
            title="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Arama ve Kapsam Çubuğu */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Misafir adı veya soyadı ile geçmiş rezervasyon ara..."
              className="w-full pl-8 pr-8 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-sky-600"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-white p-0.5 rounded-md border border-slate-300 text-xs">
            <button
              type="button"
              onClick={() => setScope("PAST_ONLY")}
              className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                scope === "PAST_ONLY"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Geçmiş (Checked-Out)
            </button>
            <button
              type="button"
              onClick={() => setScope("ALL")}
              className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                scope === "ALL"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Tümü (Aktif Dahil)
            </button>
          </div>
        </div>

        {/* Ana İçerik: Sol Misafir Listesi + Sağ Konaklama Detayları */}
        {guestsList.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 gap-2">
            <Users className="w-8 h-8 text-slate-300" />
            <p className="text-xs font-bold text-slate-700">
              Aramanızla eşleşen misafir kaydı bulunamadı.
            </p>
            <p className="text-[11px] text-slate-400 max-w-sm">
              Farklı bir misafir adı deneyebilir veya &quot;Tümü (Aktif Dahil)&quot; filtresine geçebilirsiniz.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12">
            {/* Sol: Misafir Listesi */}
            <div className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-200 overflow-y-auto divide-y divide-slate-100 max-h-56 md:max-h-none">
              {guestsList.map((guest) => {
                const isSelected = activeGuest?.key === guest.key;
                return (
                  <button
                    key={guest.key}
                    type="button"
                    onClick={() => setSelectedGuestKey(guest.key)}
                    className={`w-full text-left px-3.5 py-2.5 transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-sky-50 border-r-2 border-sky-600"
                        : "hover:bg-slate-50 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-slate-900 truncate">
                        {guest.fullName}
                      </span>
                      {guest.previousNotes.length > 0 && (
                        <StickyNote
                          className="w-3.5 h-3.5 text-amber-500 shrink-0"
                          aria-label="Özel not mevcut"
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
                      <span>
                        {guest.stays.length} Konaklama · {guest.totalNights} Gece
                      </span>
                      <span className="font-bold text-emerald-700">
                        {guest.totalRevenue.toLocaleString("tr-TR")} TL
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Sağ: Seçili Misafir Detayları */}
            {activeGuest && (
              <div className="md:col-span-8 overflow-y-auto p-4 flex flex-col gap-4">
                {/* Misafir Özeti ve Toplam Gelir */}
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900">
                        {activeGuest.fullName}
                      </h3>
                      <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                        Son çıkış: {formatTrDate(activeGuest.lastCheckOut)} ·{" "}
                        {activeGuest.pastStaysCount} tamamlanmış ziyaret
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs pt-2 border-t border-slate-200">
                    <div className="bg-white p-2.5 rounded border border-slate-200">
                      <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                        <Wallet className="w-3 h-3 text-emerald-600" />
                        <span>Toplam Gelir</span>
                      </div>
                      <div className="text-sm font-extrabold text-emerald-700 font-mono tabular-nums mt-0.5">
                        {activeGuest.totalRevenue.toLocaleString("tr-TR")} TL
                      </div>
                    </div>

                    <div className="bg-white p-2.5 rounded border border-slate-200">
                      <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-sky-600" />
                        <span>Konaklama / Gece</span>
                      </div>
                      <div className="text-sm font-extrabold text-slate-900 font-mono tabular-nums mt-0.5">
                        {activeGuest.stays.length} / {activeGuest.totalNights} Gece
                      </div>
                    </div>

                    <div className="bg-white p-2.5 rounded border border-slate-200">
                      <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-slate-500" />
                        <span>Tahsil Edilen</span>
                      </div>
                      <div className="text-sm font-extrabold text-slate-900 font-mono tabular-nums mt-0.5">
                        {activeGuest.totalPaid.toLocaleString("tr-TR")} TL
                      </div>
                    </div>
                  </div>
                </div>

                {/* Önceki Ziyaretlerden Özel Notlar */}
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-extrabold text-slate-800 tracking-wide flex items-center gap-1.5">
                    <StickyNote className="w-3.5 h-3.5 text-amber-600" />
                    <span>ÖNCEKİ ZİYARET NOTLARI ({activeGuest.previousNotes.length})</span>
                  </h4>

                  {activeGuest.previousNotes.length === 0 ? (
                    <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-500">
                      Bu misafire ait önceki ziyaretlerden kayıtlı özel not bulunmuyor.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {activeGuest.previousNotes.map((item) => (
                        <div
                          key={item.resId}
                          className="p-2.5 rounded-md bg-amber-50/80 border border-amber-200 text-xs flex flex-col gap-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px] text-amber-900 font-bold">
                            <span className="font-mono">
                              {item.resCode} · Oda {item.roomNumber || "Atanmadı"}
                            </span>
                            <span className="font-mono text-amber-800">
                              {formatTrDate(item.checkIn)} – {formatTrDate(item.checkOut)}
                            </span>
                          </div>
                          <p className="text-slate-800 font-medium">{item.note}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Konaklama Geçmişi Detayları */}
                <div className="flex flex-col gap-2">
                  <h4 className="text-xs font-extrabold text-slate-800 tracking-wide flex items-center gap-1.5">
                    <BedDouble className="w-3.5 h-3.5 text-sky-600" />
                    <span>KONAKLAMA DETAYLARI ({activeGuest.stays.length})</span>
                  </h4>

                  <div className="flex flex-col gap-2">
                    {activeGuest.stays.map((stay) => (
                      <div
                        key={stay.id}
                        className="p-3 rounded-md border border-slate-200 bg-white flex flex-col gap-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-extrabold text-slate-900">
                              {stay.resCode}
                            </span>
                            <span className="font-mono font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[11px]">
                              Oda {stay.roomNumber || "—"}
                            </span>
                            <span className="text-slate-600 font-semibold">
                              {getCategoryName(stay.categoryId)}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {stay.lifecycle === "CHECKED_OUT" && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[10px]">
                                <CheckCircle2 className="w-3 h-3" />
                                CHECKED OUT
                              </span>
                            )}
                            {stay.lifecycle === "INHOUSE" && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-900 font-bold text-[10px]">
                                <BedDouble className="w-3 h-3" />
                                INHOUSE
                              </span>
                            )}
                            {stay.lifecycle === "CONFIRMED" && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700 font-bold text-[10px]">
                                <Clock className="w-3 h-3" />
                                BEKLENİYOR
                              </span>
                            )}
                            {stay.lifecycle === "CANCELLED" && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 border border-rose-300 text-rose-800 font-bold text-[10px]">
                                <Ban className="w-3 h-3" />
                                İPTAL EDİLDİ
                              </span>
                            )}
                          </div>
                        </div>

                        {stay.lifecycle === "CANCELLED" && stay.cancellationReason && (
                          <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 font-medium">
                            İptal Nedeni: {stay.cancellationReason}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                          <span className="font-medium">
                            {formatTrDate(stay.checkIn)} — {formatTrDate(stay.checkOut)} (
                            {stay.nights} Gece)
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-extrabold text-slate-900 tabular-nums">
                              Tutar: {stay.totalAmount.toLocaleString("tr-TR")} TL
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                onOpenReservationCard(stay);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Kartı Aç</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
