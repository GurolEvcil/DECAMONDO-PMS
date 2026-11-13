import React, { useMemo, useState } from "react";
import {
  History,
  X,
  Wrench,
  Ban,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  Clock,
  BedDouble,
  Lock,
} from "lucide-react";
import type { HotelRoom, RoomCategory, RoomPhysicalStatus, RoomStatusLogEntry } from "../App";

interface RoomStatusHistoryPanelProps {
  roomNumber: string | null;
  rooms: HotelRoom[];
  categories: RoomCategory[];
  logs: RoomStatusLogEntry[];
  onSelectRoom: (roomNumber: string) => void;
  onClose: () => void;
  onChangePhysicalStatus: (roomNumber: string, status: RoomPhysicalStatus, source?: string) => void;
  onToggleDirty: (roomNumber: string, source?: string) => void;
}

type LogFilter = "ALL" | "PHYSICAL_STATUS" | "CLEANLINESS" | "ROOM_LOCK";

const PHYSICAL_STATUS_LABELS: Record<
  RoomPhysicalStatus,
  { label: string; badge: string }
> = {
  AVAILABLE: {
    label: "AVAILABLE",
    badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
  OUT_OF_ORDER: {
    label: "OUT_OF_ORDER",
    badge: "bg-slate-200 text-slate-800 border-slate-300",
  },
  CLOSED_TO_SALES: {
    label: "CLOSED_TO_SALES",
    badge: "bg-rose-50 text-rose-800 border-rose-200",
  },
};

export default function RoomStatusHistoryPanel({
  roomNumber,
  rooms,
  categories,
  logs,
  onSelectRoom,
  onClose,
  onChangePhysicalStatus,
  onToggleDirty,
}: RoomStatusHistoryPanelProps) {
  const [filter, setFilter] = useState<LogFilter>("ALL");

  const activeRoom = useMemo(
    () => rooms.find((rm) => rm.roomNumber === roomNumber) || null,
    [rooms, roomNumber]
  );

  const roomLogs = useMemo(() => {
    if (!roomNumber) return [];
    return logs.filter((entry) => {
      if (entry.roomNumber !== roomNumber) return false;
      if (filter !== "ALL" && entry.changeType !== filter) return false;
      return true;
    });
  }, [logs, roomNumber, filter]);

  const countsForRoom = useMemo(() => {
    if (!roomNumber) return { all: 0, physical: 0, cleanliness: 0, lock: 0 };
    const allForRoom = logs.filter((l) => l.roomNumber === roomNumber);
    return {
      all: allForRoom.length,
      physical: allForRoom.filter((l) => l.changeType === "PHYSICAL_STATUS").length,
      cleanliness: allForRoom.filter((l) => l.changeType === "CLEANLINESS").length,
      lock: allForRoom.filter((l) => l.changeType === "ROOM_LOCK").length,
    };
  }, [logs, roomNumber]);

  if (!roomNumber || !activeRoom) return null;

  const categoryName =
    categories.find((c) => c.id === activeRoom.categoryId)?.name || "Tanımsız";
  const currentPhysicalCfg = PHYSICAL_STATUS_LABELS[activeRoom.physicalStatus];

  const renderTransitionBadge = (value: string, type: RoomStatusLogEntry["changeType"]) => {
    if (type === "PHYSICAL_STATUS") {
      if (value === "AVAILABLE") {
        return (
          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-bold text-[10px]">
            AVAILABLE
          </span>
        );
      }
      if (value === "OUT_OF_ORDER") {
        return (
          <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 border border-slate-300 font-mono font-bold text-[10px]">
            OUT_OF_ORDER
          </span>
        );
      }
      return (
        <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 font-mono font-bold text-[10px]">
          CLOSED_TO_SALES
        </span>
      );
    }

    if (type === "ROOM_LOCK") {
      if (value === "KİLİTLİ") {
        return (
          <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 font-bold text-[10px]">
            KİLİTLİ
          </span>
        );
      }
      return (
        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 font-bold text-[10px]">
          AÇIK
        </span>
      );
    }

    if (value === "KİRLİ") {
      return (
        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-950 border border-amber-300 font-bold text-[10px]">
          KİRLİ
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[10px]">
        TEMİZ
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-slate-900/35 backdrop-blur-xs no-print"
      onClick={onClose}
    >
      <aside
        aria-label="Room Status History"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white h-full border-l border-slate-200 shadow-2xl flex flex-col"
      >
        {/* Üst Başlık */}
        <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold tracking-wide truncate">
                Room Status History
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Fiziksel Durum & Temizlik Geçmişi
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              value={activeRoom.roomNumber}
              onChange={(e) => onSelectRoom(e.target.value)}
              aria-label="Oda Seç"
              className="bg-slate-800 border border-slate-700 text-white text-xs font-mono font-bold rounded px-2 py-1 focus:outline-none focus:border-sky-500"
            >
              {rooms.map((rm) => {
                const count = logs.filter((l) => l.roomNumber === rm.roomNumber).length;
                return (
                  <option key={rm.roomNumber} value={rm.roomNumber}>
                    Oda {rm.roomNumber} ({count})
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white cursor-pointer"
              title="Kapat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Seçili Oda Anlık Durumu & Hızlı Güncelleme */}
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-col gap-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BedDouble className="w-4 h-4 text-slate-600" />
              <div>
                <div className="font-mono font-extrabold text-sm text-slate-900">
                  Oda {activeRoom.roomNumber} · {activeRoom.floor}. Kat
                </div>
                <div className="text-[11px] text-slate-600 font-medium">{categoryName}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded border font-mono font-bold text-[10px] ${currentPhysicalCfg.badge}`}
              >
                {currentPhysicalCfg.label}
              </span>
              <span
                className={`px-2 py-0.5 rounded border font-bold text-[10px] ${
                  activeRoom.isDirty
                    ? "bg-amber-100 text-amber-950 border-amber-300"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200"
                }`}
              >
                {activeRoom.isDirty ? "KİRLİ" : "TEMİZ"}
              </span>
            </div>
          </div>

          {/* Hızlı Durum Değiştirme (Anında log oluşturur) */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() =>
                onChangePhysicalStatus(activeRoom.roomNumber, "AVAILABLE", "Status History Paneli")
              }
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border cursor-pointer ${
                activeRoom.physicalStatus === "AVAILABLE"
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
            >
              <ShieldCheck className="w-3 h-3" />
              <span>AVAILABLE</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onChangePhysicalStatus(
                  activeRoom.roomNumber,
                  "OUT_OF_ORDER",
                  "Status History Paneli"
                )
              }
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border cursor-pointer ${
                activeRoom.physicalStatus === "OUT_OF_ORDER"
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
            >
              <Wrench className="w-3 h-3" />
              <span>OUT_OF_ORDER</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onChangePhysicalStatus(
                  activeRoom.roomNumber,
                  "CLOSED_TO_SALES",
                  "Status History Paneli"
                )
              }
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border cursor-pointer ${
                activeRoom.physicalStatus === "CLOSED_TO_SALES"
                  ? "bg-rose-600 text-white border-rose-600"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
              }`}
            >
              <Ban className="w-3 h-3" />
              <span>CLOSED_TO_SALES</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleDirty(activeRoom.roomNumber, "Status History Paneli")}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-extrabold border cursor-pointer ml-auto ${
                activeRoom.isDirty
                  ? "bg-amber-400 border-amber-500 text-amber-950 hover:bg-amber-300"
                  : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>{activeRoom.isDirty ? "Temizle" : "Kirli İşaretle"}</span>
            </button>
          </div>
        </div>

        {/* Filtre Sekmeleri */}
        <div className="px-3.5 py-2 border-b border-slate-200 flex items-center gap-1 bg-white">
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer ${
              filter === "ALL"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Tümü ({countsForRoom.all})
          </button>
          <button
            type="button"
            onClick={() => setFilter("PHYSICAL_STATUS")}
            className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer ${
              filter === "PHYSICAL_STATUS"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Fiziksel Durum ({countsForRoom.physical})
          </button>
          <button
            type="button"
            onClick={() => setFilter("CLEANLINESS")}
            className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer ${
              filter === "CLEANLINESS"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Temizlik ({countsForRoom.cleanliness})
          </button>
          <button
            type="button"
            onClick={() => setFilter("ROOM_LOCK")}
            className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer ${
              filter === "ROOM_LOCK"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Kilit ({countsForRoom.lock})
          </button>
        </div>

        {/* Log Zaman Çizelgesi */}
        <div className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-2.5">
          {roomLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-500 flex flex-col items-center gap-2">
              <History className="w-7 h-7 text-slate-300" />
              <p className="text-xs font-semibold">
                Oda {activeRoom.roomNumber} için bu kategoride henüz durum değişikliği kaydı yok.
              </p>
              <p className="text-[11px] text-slate-400 max-w-xs">
                Fiziksel durum (AVAILABLE, OUT_OF_ORDER, CLOSED_TO_SALES) veya temizlik
                değişiklikleri yapıldığında zaman damgasıyla burada listelenir.
              </p>
            </div>
          ) : (
            roomLogs.map((entry) => (
              <div
                key={entry.id}
                className="p-3 rounded-md border border-slate-200 bg-white flex flex-col gap-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 font-bold text-slate-800">
                    {entry.changeType === "PHYSICAL_STATUS" ? (
                      <Wrench className="w-3.5 h-3.5 text-slate-600" />
                    ) : entry.changeType === "ROOM_LOCK" ? (
                      <Lock className="w-3.5 h-3.5 text-rose-600" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    )}
                    <span>
                      {entry.changeType === "PHYSICAL_STATUS"
                        ? "Fiziksel Durum"
                        : entry.changeType === "ROOM_LOCK"
                          ? "Oda Kilidi"
                          : "Temizlik Durumu"}
                    </span>
                  </span>

                  <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{entry.timestamp}</span>
                  </span>
                </div>

                {/* Geçiş: Eski -> Yeni */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {renderTransitionBadge(entry.fromValue, entry.changeType)}
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  {renderTransitionBadge(entry.toValue, entry.changeType)}
                </div>

                {/* Kullanıcı Aksiyonu ve Kaynak */}
                <div className="text-[11px] text-slate-700 font-medium flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                  <span>{entry.actionLabel}</span>
                  <span className="text-slate-400 shrink-0">{entry.source}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
