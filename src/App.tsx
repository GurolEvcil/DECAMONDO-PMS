import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  deleteField,
  getDocs,
  getDoc,
} from "firebase/firestore";
import {
  db,
  auth,
  googleProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  OperationType,
  handleFirestoreError,
  type User,
} from "./firebase";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  Pencil,
  Printer,
  Plus,
  Layers,
  X,
  CalendarPlus,
  Check,
  LogIn,
  LogOut,
  Calendar,
  BedDouble,
  Grid,
  StickyNote,
  CheckCircle2,
  Clock,
  Undo2,
  AlertCircle,
  Sparkles,
  FileText,
  Wrench,
  MessageSquare,
  Trash2,
  Save,
  Filter,
  Ban,
  ShieldCheck,
  History,
  BarChart3,
  Users,
  Lock,
  Unlock,
  UserCog,
  LayoutDashboard,
  Receipt,
  Send,
  Moon,
  RefreshCw,
  AlertTriangle,
  CalendarArrowUp,
} from "lucide-react";
import RoomOccupancyTrends from "./components/RoomOccupancyTrends";
import RoomStatusHistoryPanel from "./components/RoomStatusHistoryPanel";
import OccupancyReport from "./components/OccupancyReport";
import GuestHistoryPanel from "./components/GuestHistoryPanel";
import DashboardModule, {
  type ExchangeRatesMap,
  type ExchangeRatesMeta,
  type TcmbRateItem,
  type TcmbRateType,
  type SystemExchangeState,
} from "./components/DashboardModule";
import EndOfDayModule, {
  buildEndOfDaySnapshot,
  type EndOfDayReport,
} from "./components/EndOfDayModule";
import {
  PmsThemeProvider,
  ThemeCustomizerDrawer,
  usePmsTheme,
} from "./components/ThemeContext";

// ============================================================================
// 1. VERİ MODELLERİ VE TİPLER
// ============================================================================
type MainModule =
  | "DASHBOARD"
  | "RESERVATION"
  | "ARRIVALS"
  | "INHOUSE_RACK"
  | "DUE_OUTS"
  | "OCCUPANCY_REPORT"
  | "END_OF_DAY";
type SortField = "resCode" | "roomNumber" | "guestName" | "checkIn" | "category" | "paidAmount";
type SortDirection = "asc" | "desc";
type PaymentStatus = "ODENDI" | "KISMI_ODENDI" | "ODENMEDI";
type ResLifecycle = "CONFIRMED" | "INHOUSE" | "CHECKED_OUT" | "CANCELLED";
export type RoomPhysicalStatus = "AVAILABLE" | "OUT_OF_ORDER" | "CLOSED_TO_SALES";
type RackDisplayStatus = "INHOUSE" | "BOS" | "DUE_OUT" | "OUT_OF_ORDER" | "CLOSED_TO_SALES";

export interface RoomCategory {
  id: string;
  name: string;
  defaultRate: number;
}

export interface RoomRequests {
  teknik: string;
  hk: string;
  resepsiyon: string;
}

export type UserRole = "MANAGER" | "RECEPTION";

export interface RoomStatusLogEntry {
  id: string;
  roomNumber: string;
  changeType: "PHYSICAL_STATUS" | "CLEANLINESS" | "ROOM_LOCK";
  fromValue: string;
  toValue: string;
  actionLabel: string;
  timestamp: string;
  source: string;
}

export interface DailyRateLogEntry {
  id: string;
  categoryId: string;
  categoryName: string;
  oldRate: number;
  newRate: number;
  changedBy: string;
  changedByRole: UserRole;
  timestamp: string;
  source: string;
}

export interface HotelRoom {
  roomNumber: string;
  floor: number;
  categoryId: string;
  physicalStatus: RoomPhysicalStatus;
  isDirty?: boolean;
  isLocked?: boolean;
  lockedBy?: string;
  lockedAt?: string;
}

export interface FolioPostEntry {
  id: string;
  serviceNote: string;
  amount: number;
  postedAt: string;
  postedBy: string;
}

export interface LockedExchangeRates {
  TRY: number;
  EUR: number;
  USD: number;
  GBP: number;
  lockedDate: string;
  bulletinDate: string;
  source: string;
}

const DEFAULT_EXCHANGE_RATES: ExchangeRatesMap = {
  TRY: 1,
  EUR: 37.45,
  USD: 34.82,
  GBP: 44.15,
};

export type PaymentCurrency = "USD" | "EUR" | "TRY";

export const PAYMENT_CURRENCY_LABELS: Record<PaymentCurrency, string> = {
  USD: "USD$",
  EUR: "Euro€",
  TRY: "TL",
};

export function formatForeignCurrencyValue(amount: number, currency: PaymentCurrency): string {
  return `${amount.toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${PAYMENT_CURRENCY_LABELS[currency]}`;
}

export interface CheckInPaymentEntry {
  amount: number;
  currency: PaymentCurrency;
  lockedRate: number;
  tlAmount: number;
  lockedDate: string;
  savedAt: string;
  savedBy: string;
}

export interface Reservation {
  id: string;
  groupId?: string;
  resCode: string;
  roomNumber: string | null;
  firstName: string;
  lastName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  categoryId: string;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  totalAmount: number;
  notes: string;
  lifecycle: ResLifecycle;
  cancellationReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  checkedInAt?: string;
  checkedOutAt?: string;
  extraCharges?: FolioPostEntry[];
  checkInRates?: LockedExchangeRates;
  checkInPayment?: CheckInPaymentEntry;
}

// ============================================================================
// 2. SABİT TANIMLAR: 8 ODA KATEGORİSİ VE 4 KAT x 5 ODA (20 ODA)
// ============================================================================
const USER_ROLES: Record<
  UserRole,
  { label: string; shortLabel: string; canLockRoom: boolean }
> = {
  MANAGER: {
    label: "Otel Müdürü (Kilit Yetkili)",
    shortLabel: "Otel Müdürü",
    canLockRoom: true,
  },
  RECEPTION: {
    label: "Resepsiyon Personeli",
    shortLabel: "Resepsiyon Personeli",
    canLockRoom: false,
  },
};

const INITIAL_CATEGORIES: RoomCategory[] = [
  { id: "CAT-1", name: "Sea View Deluxe King", defaultRate: 4500 },
  { id: "CAT-2", name: "City View Deluxe King", defaultRate: 4000 },
  { id: "CAT-3", name: "Sea View King", defaultRate: 3800 },
  { id: "CAT-4", name: "City View King", defaultRate: 3400 },
  { id: "CAT-5", name: "Sea View Deluxe Twin", defaultRate: 4300 },
  { id: "CAT-6", name: "City View Deluxe Twin", defaultRate: 3800 },
  { id: "CAT-7", name: "Sea View Twin", defaultRate: 3600 },
  { id: "CAT-8", name: "City View Twin", defaultRate: 3200 },
];

const INITIAL_ROOMS: HotelRoom[] = [
  // 1. Kat
  { roomNumber: "4101", floor: 1, categoryId: "CAT-1", physicalStatus: "AVAILABLE" },
  { roomNumber: "4102", floor: 1, categoryId: "CAT-4", physicalStatus: "AVAILABLE", isDirty: true },
  { roomNumber: "4103", floor: 1, categoryId: "CAT-8", physicalStatus: "AVAILABLE" },
  { roomNumber: "4104", floor: 1, categoryId: "CAT-2", physicalStatus: "AVAILABLE" },
  { roomNumber: "4105", floor: 1, categoryId: "CAT-8", physicalStatus: "OUT_OF_ORDER" },
  // 2. Kat
  { roomNumber: "4201", floor: 2, categoryId: "CAT-2", physicalStatus: "AVAILABLE" },
  { roomNumber: "4202", floor: 2, categoryId: "CAT-4", physicalStatus: "AVAILABLE" },
  { roomNumber: "4203", floor: 2, categoryId: "CAT-6", physicalStatus: "AVAILABLE" },
  { roomNumber: "4204", floor: 2, categoryId: "CAT-6", physicalStatus: "CLOSED_TO_SALES" },
  { roomNumber: "4205", floor: 2, categoryId: "CAT-7", physicalStatus: "AVAILABLE" },
  // 3. Kat
  {
    roomNumber: "4301",
    floor: 3,
    categoryId: "CAT-3",
    physicalStatus: "AVAILABLE",
    isLocked: true,
    lockedBy: "Otel Müdürü",
    lockedAt: "Bugün · 10:20:00",
  },
  { roomNumber: "4302", floor: 3, categoryId: "CAT-3", physicalStatus: "AVAILABLE" },
  { roomNumber: "4303", floor: 3, categoryId: "CAT-5", physicalStatus: "AVAILABLE" },
  { roomNumber: "4304", floor: 3, categoryId: "CAT-4", physicalStatus: "AVAILABLE" },
  { roomNumber: "4305", floor: 3, categoryId: "CAT-7", physicalStatus: "AVAILABLE" },
  // 4. Kat
  { roomNumber: "4401", floor: 4, categoryId: "CAT-1", physicalStatus: "OUT_OF_ORDER" },
  { roomNumber: "4402", floor: 4, categoryId: "CAT-1", physicalStatus: "AVAILABLE" },
  { roomNumber: "4403", floor: 4, categoryId: "CAT-1", physicalStatus: "AVAILABLE" },
  { roomNumber: "4404", floor: 4, categoryId: "CAT-5", physicalStatus: "AVAILABLE" },
  { roomNumber: "4405", floor: 4, categoryId: "CAT-1", physicalStatus: "AVAILABLE" },
];

const RACK_STATUS_STYLES: Record<
  RackDisplayStatus,
  { label: string; cardBg: string; cardBorder: string; badgeBg: string; badgeText: string }
> = {
  INHOUSE: {
    label: "INHOUSE",
    cardBg: "bg-[var(--pms-rack-inhouse)]",
    cardBorder: "border-sky-300",
    badgeBg: "bg-sky-200",
    badgeText: "text-sky-900",
  },
  BOS: {
    label: "BOŞ",
    cardBg: "bg-[var(--pms-rack-available)]",
    cardBorder: "border-emerald-300",
    badgeBg: "bg-emerald-600",
    badgeText: "text-white",
  },
  DUE_OUT: {
    label: "DUE OUT",
    cardBg: "bg-[var(--pms-rack-dueout)]",
    cardBorder: "border-amber-300",
    badgeBg: "bg-amber-400",
    badgeText: "text-amber-950",
  },
  OUT_OF_ORDER: {
    label: "OUT OF ORDER",
    cardBg: "bg-[var(--pms-rack-blocked)]",
    cardBorder: "border-slate-400",
    badgeBg: "bg-slate-600",
    badgeText: "text-white",
  },
  CLOSED_TO_SALES: {
    label: "CLOSED TO SALES",
    cardBg: "bg-[var(--pms-rack-blocked)]",
    cardBorder: "border-rose-300",
    badgeBg: "bg-rose-400",
    badgeText: "text-rose-950",
  },
};

const PAYMENT_BADGE_STYLES: Record<
  PaymentStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  ODENDI: {
    label: "ÖDENDİ",
    bg: "bg-emerald-50",
    text: "text-emerald-800",
    border: "border-emerald-200",
  },
  KISMI_ODENDI: {
    label: "KISMİ ÖDENDİ",
    bg: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
  },
  ODENMEDI: {
    label: "ÖDENMEDİ",
    bg: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-200",
  },
};

// ============================================================================
// 3. YARDIMCI FONKSİYONLAR
// ============================================================================
function getSystemTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISOLocal(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDaysISO(isoDate: string, days: number): string {
  const dt = parseISOLocal(isoDate);
  dt.setDate(dt.getDate() + days);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTrDate(isoDate: string): string {
  if (!isoDate) return "";
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const [y, m, d] = isoDate.split("-");
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

function calculateNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 1;
  const start = parseISOLocal(checkIn).getTime();
  const end = parseISOLocal(checkOut).getTime();
  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 1;
}

function formatNowTimestamp(): string {
  const now = new Date();
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const d = now.getDate();
  const m = months[now.getMonth()];
  const y = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${d} ${m} ${y} · ${hh}:${mm}:${ss}`;
}

// ============================================================================
// 4. ORTAK REZERVASYON KARTI (RESERVATION & ARRIVALS İÇİN BİREBİR AYNI)
// ============================================================================
interface ReservationCardModalProps {
  isOpen: boolean;
  mode: "CREATE" | "EDIT";
  initialData?: Reservation | null;
  categories: RoomCategory[];
  rooms: HotelRoom[];
  reservations: Reservation[];
  currentUserRole: UserRole;
  dailyRateLogs: DailyRateLogEntry[];
  onRecordRateChange: (
    categoryId: string,
    oldRate: number,
    newRate: number,
    source?: string
  ) => void;
  onUpdateCategories: (updated: RoomCategory[]) => void;
  defaultCheckInDate: string;
  exchangeRates: ExchangeRatesMap;
  activeRateType: TcmbRateType;
  ratesBulletinDate: string;
  onClose: () => void;
  onSave: (savedRow: Reservation, isNew: boolean) => void;
  onCancel?: (reservation: Reservation, cancellationReason: string) => Promise<void> | void;
}

function ReservationCardModal({
  isOpen,
  mode,
  initialData,
  categories,
  rooms,
  reservations,
  currentUserRole,
  dailyRateLogs,
  onRecordRateChange,
  onUpdateCategories,
  defaultCheckInDate,
  exchangeRates,
  activeRateType,
  ratesBulletinDate,
  onClose,
  onSave,
  onCancel,
}: ReservationCardModalProps) {
  const [firstName, setFirstName] = useState(initialData?.firstName || "");
  const [lastName, setLastName] = useState(initialData?.lastName || "");
  const [roomNumber, setRoomNumber] = useState(initialData?.roomNumber || "");
  const [checkInDate, setCheckInDate] = useState(initialData?.checkIn || defaultCheckInDate);
  const [checkOutDate, setCheckOutDate] = useState(
    initialData?.checkOut || addDaysISO(defaultCheckInDate, 2)
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    initialData?.categoryId || categories[0].id
  );
  const [totalPrice, setTotalPrice] = useState<number>(
    initialData?.totalAmount ?? categories[0].defaultRate * 2
  );
  const [paidAmount, setPaidAmount] = useState<number>(initialData?.paidAmount ?? 0);
  const [notes, setNotes] = useState<string>(initialData?.notes || "");
  const [calcCurrency, setCalcCurrency] = useState<"EUR" | "USD" | "GBP">("EUR");
  const [calcForeignAmount, setCalcForeignAmount] = useState<string>("");

  const [isEditingCats, setIsEditingCats] = useState(false);
  const [showCatRateHistory, setShowCatRateHistory] = useState(false);
  const [draftCats, setDraftCats] = useState<RoomCategory[]>(categories);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  if (!isOpen) return null;

  const isCancelledRes = mode === "EDIT" && initialData?.lifecycle === "CANCELLED";
  const isActiveCancellable =
    mode === "EDIT" &&
    Boolean(initialData) &&
    (initialData?.lifecycle === "CONFIRMED" || initialData?.lifecycle === "INHOUSE");

  const initialRoomObj = initialData?.roomNumber
    ? rooms.find((rm) => rm.roomNumber === initialData.roomNumber)
    : undefined;
  const selectedRoomObj = roomNumber
    ? rooms.find((rm) => rm.roomNumber === roomNumber)
    : undefined;
  const lockedRoomObj = initialRoomObj?.isLocked
    ? initialRoomObj
    : selectedRoomObj?.isLocked
      ? selectedRoomObj
      : null;
  const isRoomLocked = Boolean(lockedRoomObj);
  const isReceptionRestricted = currentUserRole === "RECEPTION" && isRoomLocked;

  const nights = calculateNights(checkInDate, checkOutDate);
  const extraChargesTotal = (initialData?.extraCharges || []).reduce(
    (sum, item) => sum + item.amount,
    0
  );
  const remainingPayment = Math.max(0, totalPrice - paidAmount);
  const effectiveRates: ExchangeRatesMap = initialData?.checkInRates ?? exchangeRates;
  const hasLockedCheckInRates = Boolean(initialData?.checkInRates);
  const activeCalcRate = Math.max(0.0001, effectiveRates[calcCurrency] || 1);
  const parsedForeignVal = Math.max(0, Number(calcForeignAmount) || 0);
  const convertedForeignTry = Math.round(parsedForeignVal * activeCalcRate);

  const handleDateOrCatChange = (newIn: string, newOut: string, newCatId: string) => {
    const safeOut = newOut <= newIn ? addDaysISO(newIn, 1) : newOut;
    const effectiveCatId = isReceptionRestricted ? selectedCategoryId : newCatId;
    setCheckInDate(newIn);
    setCheckOutDate(safeOut);
    setSelectedCategoryId(effectiveCatId);

    const n = calculateNights(newIn, safeOut);
    const cat = categories.find((c) => c.id === effectiveCatId) || categories[0];
    setTotalPrice(cat.defaultRate * n + extraChargesTotal);
  };

  const handleSaveCats = () => {
    const cleaned = draftCats.map((d, idx) => ({
      ...d,
      name: d.name.trim() || categories[idx].name,
      defaultRate: Math.max(0, Math.round(Number(d.defaultRate) || 0)),
    }));
    cleaned.forEach((cat, idx) => {
      const prevRate = categories[idx]?.defaultRate ?? 0;
      if (cat.defaultRate !== prevRate) {
        onRecordRateChange(
          cat.id,
          prevRate,
          cat.defaultRate,
          "Rezervasyon Kartı Kategori Ayarları"
        );
      }
    });
    onUpdateCategories(cleaned);
    setIsEditingCats(false);
    setShowCatRateHistory(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;

    let status: PaymentStatus = "ODENMEDI";
    if (paidAmount >= totalPrice && totalPrice > 0) status = "ODENDI";
    else if (paidAmount > 0 && paidAmount < totalPrice) status = "KISMI_ODENDI";

    const rowPayload: Reservation = {
      id: initialData?.id || `RES-${Date.now()}`,
      groupId: initialData?.groupId,
      resCode: initialData?.resCode || `SF-${Math.floor(1000 + Math.random() * 9000)}`,
      roomNumber: roomNumber.trim() ? roomNumber.trim() : null,
      firstName: firstName.trim().toLocaleUpperCase("tr-TR"),
      lastName: lastName.trim().toLocaleUpperCase("tr-TR"),
      checkIn: checkInDate,
      checkOut: checkOutDate,
      nights,
      categoryId: selectedCategoryId,
      paymentStatus: status,
      paidAmount,
      totalAmount: totalPrice,
      notes,
      lifecycle: initialData?.lifecycle || "CONFIRMED",
      checkedInAt: initialData?.checkedInAt,
      checkedOutAt: initialData?.checkedOutAt,
      extraCharges: initialData?.extraCharges,
      checkInRates: initialData?.checkInRates,
      checkInPayment: initialData?.checkInPayment,
    };

    onSave(rowPayload, mode === "CREATE");
  };

  const handleConfirmCancel = async () => {
    if (!initialData || !onCancel || isCancelling) return;
    const trimmed = cancelReason.trim();
    if (!trimmed) {
      setCancelError("Lütfen rezervasyon iptal nedenini not alanına yazın.");
      return;
    }
    setCancelError("");
    setIsCancelling(true);
    try {
      await onCancel(initialData, trimmed);
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl border border-slate-300 w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2">
            <CalendarPlus className="w-4 h-4 text-sky-400" />
            <h2 className="font-bold text-sm tracking-wide">
              {mode === "CREATE"
                ? "YENİ REZERVASYON KARTI"
                : `REZERVASYON KARTI — ${initialData?.resCode}`}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3 text-xs overflow-y-auto">
          {isCancelledRes && (
            <div className="p-2.5 rounded-md border bg-rose-50 border-rose-300 text-rose-950 flex items-start gap-2">
              <Ban className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                <div className="font-extrabold">
                  BU REZERVASYON İPTAL EDİLDİ
                  {initialData?.cancelledAt ? ` (${initialData.cancelledAt})` : ""}
                </div>
                <p className="mt-0.5 font-semibold">
                  İptal Nedeni: {initialData?.cancellationReason || "Belirtilmedi"}
                </p>
                {initialData?.cancelledBy && (
                  <p className="text-[10px] text-rose-700 mt-0.5">
                    İşlemi Yapan: {initialData.cancelledBy}
                  </p>
                )}
              </div>
            </div>
          )}
          {isRoomLocked && (
            <div
              className={`p-2.5 rounded-md border flex items-start gap-2 ${
                isReceptionRestricted
                  ? "bg-rose-50 border-rose-300 text-rose-950"
                  : "bg-amber-50 border-amber-300 text-amber-950"
              }`}
            >
              <Lock
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  isReceptionRestricted ? "text-rose-600" : "text-amber-700"
                }`}
              />
              <div className="text-[11px] leading-relaxed">
                <div className="font-extrabold">
                  ODA {lockedRoomObj?.roomNumber} KİLİTLİ
                  {isReceptionRestricted
                    ? " — RESEPSİYON DÜZENLEMESİ ENGELLENDİ"
                    : " (OTEL MÜDÜRÜ YETKİSİ AKTİF)"}
                </div>
                <p className="mt-0.5 font-medium">
                  {isReceptionRestricted
                    ? `Bu oda yetkili kullanıcı (${lockedRoomObj?.lockedBy || "Otel Müdürü"}) tarafından kilitlenmiştir. Resepsiyon personeli oda tipi değişikliği, oda değişimi ve misafir bilgisi (Ad / Soyad) düzenlemesi yapamaz.`
                    : `Bu oda kilitli durumdadır. Resepsiyon personeli oda tipi ve misafir bilgisi düzenleyemez; yönetici olarak düzenleme yapabilir veya INHOUSE/RACK üzerinden kilidi açabilirsiniz.`}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 flex items-center gap-1 mb-1">
                <span>Ad *</span>
                {isReceptionRestricted && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-rose-700">
                    <Lock className="w-2.5 h-2.5" />
                    KİLİTLİ
                  </span>
                )}
              </label>
              <input
                type="text"
                required
                autoFocus={!isReceptionRestricted}
                disabled={isReceptionRestricted}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Örn: Ahmet"
                className={`w-full border rounded px-2.5 py-1.5 text-sm font-medium focus:outline-none ${
                  isReceptionRestricted
                    ? "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                    : "border-slate-300 focus:border-sky-600"
                }`}
              />
            </div>
            <div>
              <label className="font-bold text-slate-700 flex items-center gap-1 mb-1">
                <span>Soyad *</span>
                {isReceptionRestricted && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-rose-700">
                    <Lock className="w-2.5 h-2.5" />
                    KİLİTLİ
                  </span>
                )}
              </label>
              <input
                type="text"
                required
                disabled={isReceptionRestricted}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Örn: Yılmaz"
                className={`w-full border rounded px-2.5 py-1.5 text-sm font-medium focus:outline-none ${
                  isReceptionRestricted
                    ? "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                    : "border-slate-300 focus:border-sky-600"
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="font-bold text-slate-700 flex items-center gap-1 mb-1">
                <span>Oda No</span>
                {isReceptionRestricted && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-rose-700">
                    <Lock className="w-2.5 h-2.5" />
                  </span>
                )}
              </label>
              <select
                value={roomNumber}
                disabled={isReceptionRestricted}
                onChange={(e) => setRoomNumber(e.target.value)}
                className={`w-full border rounded px-2 py-1.5 text-xs font-bold focus:outline-none ${
                  isReceptionRestricted
                    ? "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                    : "border-slate-300 bg-white focus:border-sky-600"
                }`}
              >
                <option value="">Atanmadı (Boş)</option>
                {rooms.map((rm) => {
                  const inhouseGuest = reservations.find(
                    (r) =>
                      r.id !== initialData?.id &&
                      r.lifecycle === "INHOUSE" &&
                      r.roomNumber === rm.roomNumber
                  );
                  const lockSuffix = rm.isLocked ? " · KİLİTLİ" : "";
                  const statusSuffix = inhouseGuest
                    ? ` · INHOUSE (${inhouseGuest.firstName} ${inhouseGuest.lastName})`
                    : rm.physicalStatus === "OUT_OF_ORDER"
                      ? " · OOO"
                      : rm.physicalStatus === "CLOSED_TO_SALES"
                        ? " · CTS"
                        : "";
                  return (
                    <option
                      key={rm.roomNumber}
                      value={rm.roomNumber}
                      disabled={currentUserRole === "RECEPTION" && Boolean(rm.isLocked)}
                    >
                      {rm.roomNumber}
                      {lockSuffix}
                      {statusSuffix}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="font-bold text-slate-700 flex items-center gap-1">
                  <span>Oda Tipi *</span>
                  {isReceptionRestricted && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-rose-700">
                      <Lock className="w-2.5 h-2.5" />
                      KİLİTLİ
                    </span>
                  )}
                </label>
                {!isReceptionRestricted &&
                  (!isEditingCats ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftCats(categories.map((c) => ({ ...c })));
                        setShowCatRateHistory(false);
                        setIsEditingCats(true);
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 text-[10px] font-bold text-slate-700 cursor-pointer"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      EDIT
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowCatRateHistory((prev) => !prev)}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold cursor-pointer ${
                          showCatRateHistory
                            ? "bg-slate-900 text-white border-slate-900"
                            : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                        }`}
                      >
                        <History className="w-2.5 h-2.5" />
                        History ({dailyRateLogs.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveCats}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-[10px] font-extrabold text-white cursor-pointer"
                      >
                        <Check className="w-2.5 h-2.5" />
                        SAVE
                      </button>
                    </div>
                  ))}
              </div>

              {!isEditingCats ? (
                <select
                  value={selectedCategoryId}
                  disabled={isReceptionRestricted}
                  onChange={(e) => handleDateOrCatChange(checkInDate, checkOutDate, e.target.value)}
                  className={`w-full border rounded px-2.5 py-1.5 text-xs font-semibold focus:outline-none ${
                    isReceptionRestricted
                      ? "border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed"
                      : "border-slate-300 bg-white focus:border-sky-600"
                  }`}
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              ) : showCatRateHistory ? (
                <div className="p-2 bg-slate-50 border border-slate-300 rounded flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                  <div className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wide">
                    Daily Rate History ({dailyRateLogs.length})
                  </div>
                  {dailyRateLogs.length === 0 ? (
                    <div className="text-[11px] text-slate-400 py-3 text-center">
                      Henüz tarife değişikliği kaydı yok.
                    </div>
                  ) : (
                    dailyRateLogs.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-1.5 bg-white border border-slate-200 rounded text-[10px] flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-900 truncate">
                            {entry.categoryName}
                          </span>
                          <span className="font-mono font-bold text-sky-800 shrink-0">
                            {entry.oldRate.toLocaleString("tr-TR")} →{" "}
                            {entry.newRate.toLocaleString("tr-TR")} TL
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-500">
                          <span className="font-semibold text-slate-700">{entry.changedBy}</span>
                          <span className="font-mono">{entry.timestamp}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="p-2 bg-amber-50 border border-amber-300 rounded flex flex-col gap-1 max-h-36 overflow-y-auto">
                  {draftCats.map((cat, idx) => (
                    <div key={cat.id} className="flex items-center gap-1">
                      <span className="text-[10px] font-bold text-slate-500 w-3">{idx + 1}.</span>
                      <input
                        type="text"
                        value={cat.name}
                        onChange={(e) =>
                          setDraftCats((prev) =>
                            prev.map((c) => (c.id === cat.id ? { ...c, name: e.target.value } : c))
                          )
                        }
                        className="w-full px-1.5 py-0.5 text-xs font-semibold bg-white border border-slate-300 rounded"
                      />
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={cat.defaultRate}
                        onChange={(e) =>
                          setDraftCats((prev) =>
                            prev.map((c) =>
                              c.id === cat.id
                                ? { ...c, defaultRate: Math.max(0, Number(e.target.value) || 0) }
                                : c
                            )
                          )
                        }
                        aria-label={`${cat.name} Tarife`}
                        className="w-20 px-1.5 py-0.5 text-xs font-mono font-bold text-right bg-white border border-slate-300 rounded shrink-0"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Giriş Tarihi *</label>
              <input
                type="date"
                required
                value={checkInDate}
                onChange={(e) =>
                  handleDateOrCatChange(e.target.value, checkOutDate, selectedCategoryId)
                }
                className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs font-medium bg-white"
              />
            </div>
            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Çıkış Tarihi * <span className="text-sky-700">({nights} Gece)</span>
              </label>
              <input
                type="date"
                required
                min={checkInDate}
                value={checkOutDate}
                onChange={(e) =>
                  handleDateOrCatChange(checkInDate, e.target.value, selectedCategoryId)
                }
                className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs font-medium bg-white"
              />
            </div>
          </div>

          <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="font-bold text-slate-600 block mb-1">Total Ödeme (TL)</label>
                <input
                  type="number"
                  min={0}
                  value={totalPrice}
                  onChange={(e) => setTotalPrice(Math.max(0, Number(e.target.value)))}
                  className="w-full border border-slate-300 rounded px-2 py-1 font-bold text-xs bg-white tabular-nums"
                />
                <div className="mt-1 text-[10px] font-mono text-slate-600 tabular-nums">
                  ≈ {(totalPrice / effectiveRates.EUR).toFixed(2)} € ·{" "}
                  {(totalPrice / effectiveRates.USD).toFixed(2)} $ ·{" "}
                  {(totalPrice / effectiveRates.GBP).toFixed(2)} £
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Yapılan Ödeme</label>
                <input
                  type="number"
                  min={0}
                  max={totalPrice}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(Math.max(0, Number(e.target.value)))}
                  className="w-full border border-emerald-400 rounded px-2 py-1 font-bold text-xs bg-white text-emerald-900 tabular-nums"
                />
              </div>

              <div>
                <label className="font-bold text-slate-600 block mb-1">Kalan Ödeme</label>
                <div
                  className={`w-full px-2 py-1 rounded border font-extrabold text-xs tabular-nums ${
                    remainingPayment > 0
                      ? "bg-amber-50 border-amber-300 text-amber-800"
                      : "bg-emerald-50 border-emerald-300 text-emerald-800"
                  }`}
                >
                  {remainingPayment.toLocaleString("tr-TR")} TL
                </div>
                {remainingPayment > 0 && (
                  <div className="mt-1 text-[10px] font-mono font-bold text-amber-800 tabular-nums">
                    ≈ {(remainingPayment / effectiveRates.EUR).toFixed(2)} € ·{" "}
                    {(remainingPayment / effectiveRates.USD).toFixed(2)} $ ·{" "}
                    {(remainingPayment / effectiveRates.GBP).toFixed(2)} £
                  </div>
                )}
              </div>
            </div>

            <div className="pt-1.5 border-t border-slate-200 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                <span className="font-extrabold text-slate-700">
                  Döviz Hesaplama &amp; Tahsilat
                </span>
                <span className="font-mono font-bold text-sky-800">
                  {hasLockedCheckInRates
                    ? `Sabit Check-In Kuru (${formatTrDate(initialData!.checkInRates!.lockedDate)})`
                    : `TCMB ${activeRateType === "FOREX_BUYING" ? "Alış" : "Satış"} (${ratesBulletinDate})`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={calcCurrency}
                  onChange={(e) => setCalcCurrency(e.target.value as "EUR" | "USD" | "GBP")}
                  aria-label="Hesaplama Döviz Birimi"
                  className="border border-slate-300 rounded px-2 py-1 text-[11px] font-bold bg-white"
                >
                  <option value="EUR">EUR ({effectiveRates.EUR.toFixed(4)} TL)</option>
                  <option value="USD">USD ({effectiveRates.USD.toFixed(4)} TL)</option>
                  <option value="GBP">GBP ({effectiveRates.GBP.toFixed(4)} TL)</option>
                </select>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={calcForeignAmount}
                  onChange={(e) => setCalcForeignAmount(e.target.value)}
                  placeholder={`Tutar (${calcCurrency})`}
                  className="w-28 border border-slate-300 rounded px-2 py-1 text-[11px] font-mono font-bold bg-white tabular-nums"
                />
                <span className="text-[11px] font-mono font-extrabold text-slate-800 tabular-nums">
                  = {convertedForeignTry.toLocaleString("tr-TR")} TL
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    disabled={convertedForeignTry <= 0}
                    onClick={() => {
                      if (convertedForeignTry > 0) {
                        setTotalPrice(convertedForeignTry);
                      }
                    }}
                    className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-[10px] font-bold cursor-pointer disabled:cursor-not-allowed"
                  >
                    Total&apos;e Yaz
                  </button>
                  <button
                    type="button"
                    disabled={convertedForeignTry <= 0}
                    onClick={() => {
                      if (convertedForeignTry > 0) {
                        setPaidAmount((prev) =>
                          Math.min(
                            totalPrice > 0 ? totalPrice : convertedForeignTry,
                            prev + convertedForeignTry
                          )
                        );
                        setCalcForeignAmount("");
                      }
                    }}
                    className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-[10px] font-bold cursor-pointer disabled:cursor-not-allowed"
                  >
                    Ödeme Ekle
                  </button>
                </div>
              </div>
            </div>

            {extraChargesTotal > 0 && (
              <div className="pt-1.5 border-t border-slate-200 flex items-center justify-between text-[11px] text-indigo-800 font-semibold">
                <span>Ekstra POST Hizmetleri ({initialData?.extraCharges?.length} kalem):</span>
                <span className="font-mono font-bold tabular-nums">
                  +{extraChargesTotal.toLocaleString("tr-TR")} TL
                </span>
              </div>
            )}
            {initialData?.checkInPayment && (
              <div className="pt-1.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-sky-950 bg-sky-50/70 rounded px-2 py-1">
                <span className="inline-flex items-center gap-1 font-bold">
                  <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                  <span>
                    Kayıtlı Check-In Ödemesi ({formatTrDate(initialData.checkInPayment.lockedDate)}):
                  </span>
                </span>
                <span className="font-mono font-extrabold tabular-nums">
                  {formatForeignCurrencyValue(
                    initialData.checkInPayment.amount,
                    initialData.checkInPayment.currency
                  )}{" "}
                  ={" "}
                  {initialData.checkInPayment.tlAmount.toLocaleString("tr-TR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  TL (Kur: {initialData.checkInPayment.lockedRate.toFixed(4)})
                </span>
              </div>
            )}
            {initialData?.checkInRates && (
              <div className="pt-1.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-900">
                <span className="inline-flex items-center gap-1 font-bold">
                  <Lock className="w-3 h-3 text-emerald-700" />
                  <span>
                    Check-In Kuru Sabit ({formatTrDate(initialData.checkInRates.lockedDate)} ·{" "}
                    {initialData.checkInRates.source})
                  </span>
                </span>
                <span className="font-mono font-bold tabular-nums">
                  EUR {initialData.checkInRates.EUR.toFixed(4)} · USD{" "}
                  {initialData.checkInRates.USD.toFixed(4)} · GBP{" "}
                  {initialData.checkInRates.GBP.toFixed(4)}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="font-bold text-slate-700 flex items-center gap-1 mb-1">
              <StickyNote className="w-3.5 h-3.5 text-slate-500" />
              Notlar / Serbest Not
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Misafir notları, özel istekler, geliş saati..."
              className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs bg-slate-50/60 focus:bg-white focus:outline-none focus:border-sky-600 resize-y"
            />
          </div>

          {isActiveCancellable && showCancelPanel && (
            <div className="p-3 rounded-md bg-rose-50 border border-rose-300 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <label className="font-extrabold text-rose-950 flex items-center gap-1.5">
                  <Ban className="w-3.5 h-3.5 text-rose-600" />
                  <span>REZERVASYON İPTAL NEDENİ *</span>
                </label>
                <span className="text-[10px] font-mono text-rose-700">
                  {cancelReason.length}/500
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  "Misafir talebiyle iptal",
                  "Tarih / plan değişikliği",
                  "No-Show (Gelmedi)",
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setCancelReason(preset);
                      setCancelError("");
                    }}
                    className="px-2 py-0.5 rounded bg-white hover:bg-rose-100 border border-rose-200 text-[10px] font-bold text-rose-900 cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <textarea
                rows={2}
                maxLength={500}
                value={cancelReason}
                onChange={(e) => {
                  setCancelReason(e.target.value);
                  if (cancelError) setCancelError("");
                }}
                placeholder="İptal nedenini detaylı not olarak yazın..."
                className="w-full border border-rose-300 rounded px-2.5 py-1.5 text-xs bg-white text-slate-900 focus:outline-none focus:border-rose-600 resize-y"
              />

              {cancelError && (
                <div className="text-[11px] font-bold text-rose-700">{cancelError}</div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isCancelling}
                  onClick={() => {
                    setShowCancelPanel(false);
                    setCancelError("");
                  }}
                  className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  disabled={isCancelling}
                  onClick={() => void handleConfirmCancel()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-extrabold tracking-wide cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>{isCancelling ? "İPTAL EDİLİYOR..." : "İPTALİ ONAYLA"}</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
            <div>
              {isActiveCancellable && onCancel && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCancelPanel((prev) => !prev);
                    setCancelError("");
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-700 font-extrabold tracking-wide cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Rezervasyonu İptal Et</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold tracking-wide cursor-pointer"
              >
                KAPAT
              </button>
              {!isCancelledRes && (
                <button
                  type="submit"
                  className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold tracking-wide shadow-xs cursor-pointer"
                >
                  SAVE
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const INITIAL_ROOM_REQUESTS: Record<string, RoomRequests> = {
  "4104": {
    teknik: "Banyo bataryası sızdırıyor, kontrol edilmeli.",
    hk: "Odaya ekstra yastık bırakılacak.",
    resepsiyon: "",
  },
  "4301": {
    teknik: "",
    hk: "",
    resepsiyon: "Sabah 07:30 uyandırma servisi istedi.",
  },
};

function buildInitialReservations(
  systemToday: string,
  yesterday: string,
  tomorrow: string,
  next3Days: string
): Reservation[] {
  return [
    // --- BUGÜN GİRİŞ YAPACAKLAR (ARRIVALS) ---
    {
      id: "R-101",
      resCode: "SF-8192",
      roomNumber: "4101",
      firstName: "AHMET",
      lastName: "YILMAZ",
      checkIn: systemToday,
      checkOut: next3Days,
      nights: 3,
      categoryId: "CAT-1",
      paymentStatus: "ODENDI",
      paidAmount: 13500,
      totalAmount: 13500,
      notes: "Yüksek kat ve sessiz oda talep edildi.",
      lifecycle: "CONFIRMED",
    },
    {
      id: "R-102",
      resCode: "SF-8193",
      roomNumber: null,
      firstName: "MELİS",
      lastName: "ŞEN",
      checkIn: systemToday,
      checkOut: addDaysISO(systemToday, 2),
      nights: 2,
      categoryId: "CAT-4",
      paymentStatus: "KISMI_ODENDI",
      paidAmount: 3400,
      totalAmount: 6800,
      notes: "14:30 gibi giriş yapacak.",
      lifecycle: "CONFIRMED",
    },
    {
      id: "R-103",
      groupId: "GRP-KAYA",
      resCode: "SF-3104",
      roomNumber: "4201",
      firstName: "SELİN",
      lastName: "KAYA",
      checkIn: systemToday,
      checkOut: next3Days,
      nights: 3,
      categoryId: "CAT-2",
      paymentStatus: "ODENDI",
      paidAmount: 12000,
      totalAmount: 12000,
      notes: "Çoklu oda rezervasyonu (1/2)",
      lifecycle: "CONFIRMED",
    },
    {
      id: "R-104",
      groupId: "GRP-KAYA",
      resCode: "SF-3105",
      roomNumber: "4203",
      firstName: "SELİN",
      lastName: "KAYA",
      checkIn: systemToday,
      checkOut: next3Days,
      nights: 3,
      categoryId: "CAT-6",
      paymentStatus: "ODENMEDI",
      paidAmount: 0,
      totalAmount: 11400,
      notes: "Çoklu oda rezervasyonu (2/2)",
      lifecycle: "CONFIRMED",
    },

    // --- HALİHAZIRDA KONAKLAYANLAR (INHOUSE) ---
    {
      id: "R-201",
      resCode: "SF-7710",
      roomNumber: "4104",
      firstName: "CAN",
      lastName: "DEMİR",
      checkIn: yesterday,
      checkOut: tomorrow,
      nights: 3,
      categoryId: "CAT-2",
      paymentStatus: "ODENDI",
      paidAmount: 12000,
      totalAmount: 12000,
      notes: "",
      lifecycle: "INHOUSE",
      checkedInAt: "14:10",
    },
    {
      id: "R-202",
      resCode: "SF-7712",
      roomNumber: "4301",
      firstName: "ELİF",
      lastName: "ŞEN",
      checkIn: systemToday,
      checkOut: next3Days,
      nights: 3,
      categoryId: "CAT-3",
      paymentStatus: "ODENDI",
      paidAmount: 11400,
      totalAmount: 11400,
      notes: "Erken giriş yapıldı.",
      lifecycle: "INHOUSE",
      checkedInAt: "10:15",
    },
    {
      id: "R-203",
      resCode: "SF-7715",
      roomNumber: "4402",
      firstName: "HAKAN",
      lastName: "ACAR",
      checkIn: yesterday,
      checkOut: tomorrow,
      nights: 3,
      categoryId: "CAT-1",
      paymentStatus: "ODENDI",
      paidAmount: 13500,
      totalAmount: 13500,
      notes: "",
      lifecycle: "INHOUSE",
      checkedInAt: "15:20",
    },

    // --- BUGÜN ÇIKIŞ YAPACAKLAR (DUE OUTS) ---
    {
      id: "R-301",
      resCode: "SF-6501",
      roomNumber: "4103",
      firstName: "MELİSA",
      lastName: "KAYA",
      checkIn: yesterday,
      checkOut: systemToday,
      nights: 2,
      categoryId: "CAT-8",
      paymentStatus: "ODENDI",
      paidAmount: 6400,
      totalAmount: 6400,
      notes: "",
      lifecycle: "INHOUSE",
      checkedInAt: "13:00",
    },
    {
      id: "R-302",
      resCode: "SF-6502",
      roomNumber: "4205",
      firstName: "ÖMER",
      lastName: "AVCI",
      checkIn: yesterday,
      checkOut: systemToday,
      nights: 2,
      categoryId: "CAT-7",
      paymentStatus: "KISMI_ODENDI",
      paidAmount: 6000,
      totalAmount: 7200,
      notes: "Kalan 1.200 TL çıkışta tahsil edilecek.",
      lifecycle: "INHOUSE",
      checkedInAt: "14:40",
    },
    {
      id: "R-303",
      resCode: "SF-6503",
      roomNumber: "4304",
      firstName: "DERYA",
      lastName: "KARA",
      checkIn: yesterday,
      checkOut: systemToday,
      nights: 2,
      categoryId: "CAT-4",
      paymentStatus: "ODENDI",
      paidAmount: 6800,
      totalAmount: 6800,
      notes: "",
      lifecycle: "INHOUSE",
      checkedInAt: "12:15",
    },
    {
      id: "R-304",
      resCode: "SF-6504",
      roomNumber: "4405",
      firstName: "UFUK",
      lastName: "ÖZKAN",
      checkIn: yesterday,
      checkOut: systemToday,
      nights: 2,
      categoryId: "CAT-1",
      paymentStatus: "KISMI_ODENDI",
      paidAmount: 8550,
      totalAmount: 9000,
      notes: "Kalan 450 TL tahsil edilecek.",
      lifecycle: "INHOUSE",
      checkedInAt: "16:05",
    },

    // --- BUGÜN ÇIKIŞI TAMAMLANANLAR (CHECKED OUT) ---
    {
      id: "R-401",
      resCode: "SF-6490",
      roomNumber: "4102",
      firstName: "BURAK",
      lastName: "ÖZKAN",
      checkIn: yesterday,
      checkOut: systemToday,
      nights: 2,
      categoryId: "CAT-4",
      paymentStatus: "ODENDI",
      paidAmount: 6800,
      totalAmount: 6800,
      notes: "Hipoalerjenik yastık ve ekstra havlu talep edildi.",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "09:45",
    },

    // --- SON 6 GÜNÜN TAMAMLANMIŞ KONAKLAMALARI (DOLULUK TRENDİ VERİSİ) ---
    {
      id: "R-501",
      resCode: "SF-6101",
      roomNumber: "4101",
      firstName: "KEREM",
      lastName: "AYDIN",
      checkIn: addDaysISO(systemToday, -6),
      checkOut: addDaysISO(systemToday, -3),
      nights: 3,
      categoryId: "CAT-1",
      paymentStatus: "ODENDI",
      paidAmount: 13500,
      totalAmount: 13500,
      notes: "Geç çıkış (14:00) sağlandı, kurumsal fatura kesildi.",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:00",
    },
    {
      id: "R-502",
      resCode: "SF-6102",
      roomNumber: "4402",
      firstName: "ZEYNEP",
      lastName: "KOÇ",
      checkIn: addDaysISO(systemToday, -6),
      checkOut: addDaysISO(systemToday, -2),
      nights: 4,
      categoryId: "CAT-1",
      paymentStatus: "ODENDI",
      paidAmount: 18000,
      totalAmount: 18000,
      notes: "Meyve sepeti ikram edildi; balkonlu kat tercih ediyor.",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:20",
    },
    {
      id: "R-503",
      resCode: "SF-6103",
      roomNumber: "4403",
      firstName: "EMRE",
      lastName: "DOĞAN",
      checkIn: addDaysISO(systemToday, -4),
      checkOut: addDaysISO(systemToday, -2),
      nights: 2,
      categoryId: "CAT-1",
      paymentStatus: "ODENDI",
      paidAmount: 9000,
      totalAmount: 9000,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "10:30",
    },
    {
      id: "R-504",
      resCode: "SF-6104",
      roomNumber: "4405",
      firstName: "ALPER",
      lastName: "TEKİN",
      checkIn: addDaysISO(systemToday, -5),
      checkOut: addDaysISO(systemToday, -3),
      nights: 2,
      categoryId: "CAT-1",
      paymentStatus: "ODENDI",
      paidAmount: 9000,
      totalAmount: 9000,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:45",
    },
    {
      id: "R-505",
      resCode: "SF-6105",
      roomNumber: "4201",
      firstName: "NAZ",
      lastName: "ERDEM",
      checkIn: addDaysISO(systemToday, -6),
      checkOut: addDaysISO(systemToday, -3),
      nights: 3,
      categoryId: "CAT-2",
      paymentStatus: "ODENDI",
      paidAmount: 12000,
      totalAmount: 12000,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "10:50",
    },
    {
      id: "R-506",
      resCode: "SF-6106",
      roomNumber: "4104",
      firstName: "CEM",
      lastName: "ASLAN",
      checkIn: addDaysISO(systemToday, -4),
      checkOut: addDaysISO(systemToday, -2),
      nights: 2,
      categoryId: "CAT-2",
      paymentStatus: "ODENDI",
      paidAmount: 8000,
      totalAmount: 8000,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:10",
    },
    {
      id: "R-507",
      resCode: "SF-6107",
      roomNumber: "4301",
      firstName: "DENİZ",
      lastName: "YILDIZ",
      checkIn: addDaysISO(systemToday, -5),
      checkOut: addDaysISO(systemToday, -2),
      nights: 3,
      categoryId: "CAT-3",
      paymentStatus: "ODENDI",
      paidAmount: 11400,
      totalAmount: 11400,
      notes: "Havaalanı VIP transfer düzenlendi.",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "10:15",
    },
    {
      id: "R-508",
      resCode: "SF-6108",
      roomNumber: "4302",
      firstName: "TOLGA",
      lastName: "KURT",
      checkIn: addDaysISO(systemToday, -4),
      checkOut: addDaysISO(systemToday, -1),
      nights: 3,
      categoryId: "CAT-3",
      paymentStatus: "ODENDI",
      paidAmount: 11400,
      totalAmount: 11400,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "12:00",
    },
    {
      id: "R-509",
      resCode: "SF-6109",
      roomNumber: "4202",
      firstName: "SİMGE",
      lastName: "BULUT",
      checkIn: addDaysISO(systemToday, -6),
      checkOut: addDaysISO(systemToday, -4),
      nights: 2,
      categoryId: "CAT-4",
      paymentStatus: "ODENDI",
      paidAmount: 6800,
      totalAmount: 6800,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "10:40",
    },
    {
      id: "R-510",
      resCode: "SF-6110",
      roomNumber: "4304",
      firstName: "MURAT",
      lastName: "ÇELİK",
      checkIn: addDaysISO(systemToday, -4),
      checkOut: addDaysISO(systemToday, -2),
      nights: 2,
      categoryId: "CAT-4",
      paymentStatus: "ODENDI",
      paidAmount: 6800,
      totalAmount: 6800,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:30",
    },
    {
      id: "R-511",
      resCode: "SF-6111",
      roomNumber: "4303",
      firstName: "İREM",
      lastName: "ARSLAN",
      checkIn: addDaysISO(systemToday, -4),
      checkOut: addDaysISO(systemToday, -1),
      nights: 3,
      categoryId: "CAT-5",
      paymentStatus: "ODENDI",
      paidAmount: 12900,
      totalAmount: 12900,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:05",
    },
    {
      id: "R-512",
      resCode: "SF-6112",
      roomNumber: "4404",
      firstName: "KADİR",
      lastName: "ŞAHİN",
      checkIn: addDaysISO(systemToday, -3),
      checkOut: addDaysISO(systemToday, -1),
      nights: 2,
      categoryId: "CAT-5",
      paymentStatus: "ODENDI",
      paidAmount: 8600,
      totalAmount: 8600,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "10:25",
    },
    {
      id: "R-513",
      resCode: "SF-6113",
      roomNumber: "4203",
      firstName: "ECE",
      lastName: "GÜNEŞ",
      checkIn: addDaysISO(systemToday, -5),
      checkOut: addDaysISO(systemToday, -3),
      nights: 2,
      categoryId: "CAT-6",
      paymentStatus: "ODENDI",
      paidAmount: 7600,
      totalAmount: 7600,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:50",
    },
    {
      id: "R-514",
      resCode: "SF-6114",
      roomNumber: "4305",
      firstName: "BARIŞ",
      lastName: "AKSOY",
      checkIn: addDaysISO(systemToday, -6),
      checkOut: addDaysISO(systemToday, -3),
      nights: 3,
      categoryId: "CAT-7",
      paymentStatus: "ODENDI",
      paidAmount: 10800,
      totalAmount: 10800,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "10:55",
    },
    {
      id: "R-515",
      resCode: "SF-6115",
      roomNumber: "4205",
      firstName: "GİZEM",
      lastName: "POLAT",
      checkIn: addDaysISO(systemToday, -4),
      checkOut: addDaysISO(systemToday, -2),
      nights: 2,
      categoryId: "CAT-7",
      paymentStatus: "ODENDI",
      paidAmount: 7200,
      totalAmount: 7200,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:15",
    },
    {
      id: "R-516",
      resCode: "SF-6116",
      roomNumber: "4103",
      firstName: "ONUR",
      lastName: "TAŞ",
      checkIn: addDaysISO(systemToday, -5),
      checkOut: addDaysISO(systemToday, -2),
      nights: 3,
      categoryId: "CAT-8",
      paymentStatus: "ODENDI",
      paidAmount: 9600,
      totalAmount: 9600,
      notes: "",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "10:05",
    },
    {
      id: "R-517",
      resCode: "SF-5904",
      roomNumber: "4402",
      firstName: "AHMET",
      lastName: "YILMAZ",
      checkIn: addDaysISO(systemToday, -32),
      checkOut: addDaysISO(systemToday, -29),
      nights: 3,
      categoryId: "CAT-1",
      paymentStatus: "ODENDI",
      paidAmount: 13500,
      totalAmount: 13500,
      notes: "Sadık misafir: Asansörden uzak sessiz oda ve sert ortopedik yastık istiyor.",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "10:35",
    },
    {
      id: "R-518",
      resCode: "SF-5918",
      roomNumber: "4101",
      firstName: "ZEYNEP",
      lastName: "KOÇ",
      checkIn: addDaysISO(systemToday, -25),
      checkOut: addDaysISO(systemToday, -22),
      nights: 3,
      categoryId: "CAT-1",
      paymentStatus: "ODENDI",
      paidAmount: 13500,
      totalAmount: 13500,
      notes: "Oda içi kahve makinesi için ekstra kapsül talep etmişti.",
      lifecycle: "CHECKED_OUT",
      checkedOutAt: "11:10",
    },
  ];
}

function buildReservationCreatePayload(res: Reservation, ownerId: string) {
  const payload: Record<string, unknown> = {
    id: res.id,
    resCode: res.resCode,
    roomNumber: res.roomNumber ?? null,
    firstName: res.firstName,
    lastName: res.lastName,
    checkIn: res.checkIn,
    checkOut: res.checkOut,
    nights: Math.max(1, Math.round(res.nights)),
    categoryId: res.categoryId,
    paymentStatus: res.paymentStatus,
    paidAmount: Number(res.paidAmount) || 0,
    totalAmount: Number(res.totalAmount) || 0,
    notes: res.notes || "",
    lifecycle: res.lifecycle,
    ownerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (res.groupId) payload.groupId = res.groupId;
  if (res.checkedInAt) payload.checkedInAt = res.checkedInAt;
  if (res.checkedOutAt) payload.checkedOutAt = res.checkedOutAt;
  if (res.extraCharges && res.extraCharges.length > 0) payload.extraCharges = res.extraCharges;
  if (res.checkInRates) payload.checkInRates = res.checkInRates;
  if (res.checkInPayment) payload.checkInPayment = res.checkInPayment;
  return payload;
}

function buildRoomCreatePayload(rm: HotelRoom, ownerId: string) {
  const payload: Record<string, unknown> = {
    roomNumber: rm.roomNumber,
    floor: Math.round(rm.floor),
    categoryId: rm.categoryId,
    physicalStatus: rm.physicalStatus,
    isDirty: Boolean(rm.isDirty),
    isLocked: Boolean(rm.isLocked),
    ownerId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (rm.isLocked && rm.lockedBy) payload.lockedBy = rm.lockedBy;
  if (rm.isLocked && rm.lockedAt) payload.lockedAt = rm.lockedAt;
  return payload;
}

// ============================================================================
// 5. ANA UYGULAMA: STAYFLOW PMS (CLOUD FIRESTORE REAL-TIME)
// ============================================================================
function StayFlowPmsInner() {
  const { tokens } = usePmsTheme();
  const realToday = useMemo(() => getSystemTodayISO(), []);
  const seedYesterday = useMemo(() => addDaysISO(realToday, -2), [realToday]);
  const seedTomorrow = useMemo(() => addDaysISO(realToday, 1), [realToday]);
  const seedNext3Days = useMemo(() => addDaysISO(realToday, 3), [realToday]);

  const [activeBusinessDate, setActiveBusinessDate] = useState<string>(realToday);
  const systemToday = activeBusinessDate;
  const nextBusinessDate = useMemo(() => addDaysISO(systemToday, 1), [systemToday]);

  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [firestoreLoaded, setFirestoreLoaded] = useState(false);

  const [activeModule, setActiveModule] = useState<MainModule>("DASHBOARD");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>("MANAGER");
  const [categories, setCategories] = useState<RoomCategory[]>(INITIAL_CATEGORIES);
  const [rooms, setRooms] = useState<HotelRoom[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [roomRequests, setRoomRequests] = useState<Record<string, RoomRequests>>({});
  const [eodReports, setEodReports] = useState<EndOfDayReport[]>([]);
  const [selectedEodReportId, setSelectedEodReportId] = useState<string | null>(null);
  const [isClosingDay, setIsClosingDay] = useState(false);
  const [eodCompletedPopup, setEodCompletedPopup] = useState<{
    closedDate: string;
    nextDate: string;
    report: EndOfDayReport;
    newDayRates?: ExchangeRatesMap;
    newDayTcmbTable?: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem>;
    newDayBulletinDate?: string;
    newDayRateSource?: string;
    syncLog?: string | null;
    syncError?: string | null;
  } | null>(null);
  const DEFAULT_TCMB_RATES: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem> = useMemo(
    () => ({
      TRY: { code: "TRY", name: "TÜRK LİRASI", forexBuying: 1, forexSelling: 1 },
      USD: { code: "USD", name: "ABD DOLARI", forexBuying: 34.821, forexSelling: 34.8837 },
      EUR: { code: "EUR", name: "EURO", forexBuying: 37.452, forexSelling: 37.5194 },
      GBP: { code: "GBP", name: "İNGİLİZ STERLİNİ", forexBuying: 44.151, forexSelling: 44.3812 },
    }),
    []
  );
  const [activeRateType, setActiveRateType] = useState<TcmbRateType>("FOREX_BUYING");
  const [tcmbRatesTable, setTcmbRatesTable] = useState<
    Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem>
  >(DEFAULT_TCMB_RATES);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRatesMap>(DEFAULT_EXCHANGE_RATES);
  const [ratesMeta, setRatesMeta] = useState<ExchangeRatesMeta>({
    date: realToday,
    bulletinDate: "13.11.2026",
    source: "VARSAYILAN",
    updatedAt: "",
  });
  const [isFetchingRates, setIsFetchingRates] = useState(false);
  const [isEodModalOpen, setIsEodModalOpen] = useState(false);
  const [eodSyncLog, setEodSyncLog] = useState<string | null>(null);
  const [eodSyncError, setEodSyncError] = useState<string | null>(null);
  const [settingsSyncedTick, setSettingsSyncedTick] = useState(0);
  const [exchangeRatesSyncedTick, setExchangeRatesSyncedTick] = useState(0);
  const roomRequestDocIdsRef = useRef<Set<string>>(new Set());
  const settingsDocExistsRef = useRef<boolean>(false);
  const exchangeRatesDocExistsRef = useRef<boolean>(false);
  const settingsRatesDateRef = useRef<string | null>(null);
  const autoFetchedDateRef = useRef<string | null>(null);
  const seededUidRef = useRef<string | null>(null);

  const [showExtraModules, setShowExtraModules] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);

  // DUE OUTS ekranında her satır için "ÖDEME AL" kutusuna girilen anlık tutarlar
  const [dueOutPaymentInputs, setDueOutPaymentInputs] = useState<Record<string, string>>({});
  // INHOUSE / RACK odaları için birbirinden bağımsız Check-In günü döviz/TL ödeme taslakları
  const [rackPaymentDrafts, setRackPaymentDrafts] = useState<
    Record<string, { amount: string; currency: PaymentCurrency }>
  >({});
  const [savingRackPaymentId, setSavingRackPaymentId] = useState<string | null>(null);
  // ERKEN ÇIKIŞ (EARLY CHECK-OUT): Ödeme sabit kalır, kalmadığı geceler POST edilir, BALANCE=0 olunca Check-Out izni verilir
  const [earlyCheckOutTarget, setEarlyCheckOutTarget] = useState<Reservation | null>(null);
  const [earlyCheckOutCollectionInput, setEarlyCheckOutCollectionInput] = useState<string>("");
  const [isSubmittingEarlyCheckOut, setIsSubmittingEarlyCheckOut] = useState(false);

  // Firebase Auth Oturum Dinleyicisi
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthReady(true);
      if (!user) {
        setRooms([]);
        setReservations([]);
        setRoomRequests({});
        setEodReports([]);
        setSelectedEodReportId(null);
        setActiveBusinessDate(realToday);
        setActiveRateType("FOREX_BUYING");
        setTcmbRatesTable(DEFAULT_TCMB_RATES);
        setExchangeRates(DEFAULT_EXCHANGE_RATES);
        setRatesMeta({
          date: realToday,
          bulletinDate: "13.11.2026",
          source: "VARSAYILAN",
          updatedAt: "",
        });
        setIsEodModalOpen(false);
        setEodSyncLog(null);
        setEodSyncError(null);
        settingsDocExistsRef.current = false;
        exchangeRatesDocExistsRef.current = false;
        settingsRatesDateRef.current = null;
        autoFetchedDateRef.current = null;
        setSettingsSyncedTick(0);
        setExchangeRatesSyncedTick(0);
        setRackPaymentDrafts({});
        setEarlyCheckOutTarget(null);
        setEarlyCheckOutCollectionInput("");
        setSavingRackPaymentId(null);
        roomRequestDocIdsRef.current = new Set();
        setFirestoreLoaded(false);
        seededUidRef.current = null;
      }
    });
    return () => unsub();
  }, [realToday, DEFAULT_TCMB_RATES]);

  // Cloud Firestore Gerçek Zamanlı onSnapshot Dinleyicileri (reservations, rooms, room_requests, pms_settings, end_of_day_logs)
  useEffect(() => {
    if (!authReady || !currentUser) return;

    const isBootstrappedAdmin = currentUser.email === "ajmagichands@gmail.com";
    const settingsDocId = isBootstrappedAdmin ? "stayflow_active" : currentUser.uid;
    const roomsQ = isBootstrappedAdmin
      ? collection(db, "rooms")
      : query(collection(db, "rooms"), where("ownerId", "==", currentUser.uid));
    const resQ = isBootstrappedAdmin
      ? collection(db, "reservations")
      : query(collection(db, "reservations"), where("ownerId", "==", currentUser.uid));
    const reqQ = isBootstrappedAdmin
      ? collection(db, "room_requests")
      : query(collection(db, "room_requests"), where("ownerId", "==", currentUser.uid));
    const eodQ = isBootstrappedAdmin
      ? collection(db, "end_of_day_logs")
      : query(collection(db, "end_of_day_logs"), where("ownerId", "==", currentUser.uid));

    let cancelled = false;
    let loadedCount = 0;
    const markPartLoaded = () => {
      loadedCount += 1;
      if (loadedCount >= 3 && !cancelled) {
        setFirestoreLoaded(true);
      }
    };

    // İlk kurulum ve tek seferlik (2026-11-13) End of Day geri alma işlemi
    const ensureInitialSeedAndOneTimeRollback = async () => {
      if (seededUidRef.current === currentUser.uid) return;
      seededUidRef.current = currentUser.uid;
      const settingsRef = doc(db, "pms_settings", settingsDocId);
      try {
        const [roomsSnap, resSnap, settingsSnap, eodSnap] = await Promise.all([
          getDocs(roomsQ),
          getDocs(resQ),
          getDoc(settingsRef),
          getDocs(eodQ),
        ]);
        if (cancelled) return;
        if (roomsSnap.empty && resSnap.empty) {
          const batch = writeBatch(db);
          INITIAL_ROOMS.forEach((rm) => {
            batch.set(
              doc(db, "rooms", rm.roomNumber),
              buildRoomCreatePayload(rm, currentUser.uid)
            );
          });
          buildInitialReservations(realToday, seedYesterday, seedTomorrow, seedNext3Days).forEach((res) => {
            batch.set(
              doc(db, "reservations", res.id),
              buildReservationCreatePayload(res, currentUser.uid)
            );
          });
          Object.entries(INITIAL_ROOM_REQUESTS).forEach(([roomNumber, req]) => {
            batch.set(doc(db, "room_requests", roomNumber), {
              roomNumber,
              teknik: req.teknik,
              hk: req.hk,
              resepsiyon: req.resepsiyon,
              ownerId: currentUser.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          });
          batch.set(settingsRef, {
            id: settingsDocId,
            activeBusinessDate: "2026-11-13",
            rollback20261113Done: true,
            ownerId: currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await batch.commit();
          settingsDocExistsRef.current = true;
          setActiveBusinessDate("2026-11-13");
        } else if (!settingsSnap.exists() || settingsSnap.data()?.rollback20261113Done !== true) {
          // Sadece BU SEFERLİK: önceki END OF DAY kayıtlarını sil ve aktif tarihi 13 Kasım 2026'ya döndür
          const hadEodChanges =
            !eodSnap.empty ||
            (settingsSnap.exists() &&
              (settingsSnap.data()?.activeBusinessDate !== "2026-11-13" ||
                Boolean(settingsSnap.data()?.lastClosedDate)));

          const rollbackBatch = writeBatch(db);
          eodSnap.docs.forEach((d) => {
            rollbackBatch.delete(d.ref);
          });

          if (settingsSnap.exists()) {
            rollbackBatch.update(settingsRef, {
              activeBusinessDate: "2026-11-13",
              lastClosedDate: deleteField(),
              rollback20261113Done: true,
              updatedAt: serverTimestamp(),
            });
          } else {
            rollbackBatch.set(settingsRef, {
              id: settingsDocId,
              activeBusinessDate: "2026-11-13",
              rollback20261113Done: true,
              ownerId: currentUser.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          await rollbackBatch.commit();
          if (cancelled) return;

          settingsDocExistsRef.current = true;
          setActiveBusinessDate("2026-11-13");
          setSelectedEodReportId(null);
          setEodCompletedPopup(null);
          if (hadEodChanges) {
            setBannerMsg({
              type: "info",
              text: "End of Day işlemi tek seferlik iptal edildi, gün kapama kayıtları silindi ve sistem tarihi 13 Kas 2026 tarihine geri alındı.",
            });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, "eod_one_time_rollback");
      }
    };
    void ensureInitialSeedAndOneTimeRollback();

    const unsubRooms = onSnapshot(
      roomsQ,
      (snapshot) => {
        const nextRooms: HotelRoom[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              roomNumber: String(data.roomNumber || d.id),
              floor: Number(data.floor) || 1,
              categoryId: String(data.categoryId || "CAT-1"),
              physicalStatus: (data.physicalStatus as RoomPhysicalStatus) || "AVAILABLE",
              isDirty: Boolean(data.isDirty),
              isLocked: Boolean(data.isLocked),
              lockedBy: typeof data.lockedBy === "string" ? data.lockedBy : undefined,
              lockedAt: typeof data.lockedAt === "string" ? data.lockedAt : undefined,
            };
          })
          .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
        setRooms(nextRooms);
        markPartLoaded();
      },
      (err) => {
        setBannerMsg({ type: "error", text: "Firestore rooms dinleme hatası oluştu." });
        handleFirestoreError(err, OperationType.LIST, "rooms");
      }
    );

    const unsubReservations = onSnapshot(
      resQ,
      (snapshot) => {
        const nextRes: Reservation[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            groupId: typeof data.groupId === "string" ? data.groupId : undefined,
            resCode: String(data.resCode || ""),
            roomNumber: typeof data.roomNumber === "string" ? data.roomNumber : null,
            firstName: String(data.firstName || ""),
            lastName: String(data.lastName || ""),
            checkIn: String(data.checkIn || ""),
            checkOut: String(data.checkOut || ""),
            nights: Number(data.nights) || 1,
            categoryId: String(data.categoryId || "CAT-1"),
            paymentStatus: (data.paymentStatus as PaymentStatus) || "ODENMEDI",
            paidAmount: Number(data.paidAmount) || 0,
            totalAmount: Number(data.totalAmount) || 0,
            notes: typeof data.notes === "string" ? data.notes : "",
            lifecycle: (data.lifecycle as ResLifecycle) || "CONFIRMED",
            cancellationReason:
              typeof data.cancellationReason === "string" ? data.cancellationReason : undefined,
            cancelledAt: typeof data.cancelledAt === "string" ? data.cancelledAt : undefined,
            cancelledBy: typeof data.cancelledBy === "string" ? data.cancelledBy : undefined,
            checkedInAt: typeof data.checkedInAt === "string" ? data.checkedInAt : undefined,
            checkedOutAt: typeof data.checkedOutAt === "string" ? data.checkedOutAt : undefined,
            extraCharges: Array.isArray(data.extraCharges)
              ? (data.extraCharges as FolioPostEntry[])
              : undefined,
            checkInRates:
              data.checkInRates &&
              typeof data.checkInRates === "object" &&
              typeof (data.checkInRates as Record<string, unknown>).EUR === "number" &&
              typeof (data.checkInRates as Record<string, unknown>).USD === "number" &&
              typeof (data.checkInRates as Record<string, unknown>).GBP === "number"
                ? {
                    TRY: Number((data.checkInRates as Record<string, unknown>).TRY) || 1,
                    EUR: Number((data.checkInRates as Record<string, unknown>).EUR),
                    USD: Number((data.checkInRates as Record<string, unknown>).USD),
                    GBP: Number((data.checkInRates as Record<string, unknown>).GBP),
                    lockedDate: String(
                      (data.checkInRates as Record<string, unknown>).lockedDate || data.checkIn || ""
                    ),
                    bulletinDate: String(
                      (data.checkInRates as Record<string, unknown>).bulletinDate || ""
                    ),
                    source: String(
                      (data.checkInRates as Record<string, unknown>).source || "TCMB"
                    ),
                  }
                : undefined,
            checkInPayment:
              data.checkInPayment &&
              typeof data.checkInPayment === "object" &&
              typeof (data.checkInPayment as Record<string, unknown>).amount === "number" &&
              typeof (data.checkInPayment as Record<string, unknown>).tlAmount === "number"
                ? {
                    amount: Number((data.checkInPayment as Record<string, unknown>).amount),
                    currency: (["USD", "EUR", "TRY"].includes(
                      String((data.checkInPayment as Record<string, unknown>).currency)
                    )
                      ? String((data.checkInPayment as Record<string, unknown>).currency)
                      : "TRY") as PaymentCurrency,
                    lockedRate:
                      Number((data.checkInPayment as Record<string, unknown>).lockedRate) || 1,
                    tlAmount: Number((data.checkInPayment as Record<string, unknown>).tlAmount),
                    lockedDate: String(
                      (data.checkInPayment as Record<string, unknown>).lockedDate ||
                        data.checkIn ||
                        ""
                    ),
                    savedAt: String(
                      (data.checkInPayment as Record<string, unknown>).savedAt || ""
                    ),
                    savedBy: String(
                      (data.checkInPayment as Record<string, unknown>).savedBy || ""
                    ),
                  }
                : undefined,
          };
        });
        setReservations(nextRes);
        markPartLoaded();
      },
      (err) => {
        setBannerMsg({ type: "error", text: "Firestore reservations dinleme hatası oluştu." });
        handleFirestoreError(err, OperationType.LIST, "reservations");
      }
    );

    const unsubRoomRequests = onSnapshot(
      reqQ,
      (snapshot) => {
        const nextReqs: Record<string, RoomRequests> = {};
        const docIds = new Set<string>();
        snapshot.docs.forEach((d) => {
          const data = d.data();
          const rmNo = String(data.roomNumber || d.id);
          docIds.add(rmNo);
          nextReqs[rmNo] = {
            teknik: typeof data.teknik === "string" ? data.teknik : "",
            hk: typeof data.hk === "string" ? data.hk : "",
            resepsiyon: typeof data.resepsiyon === "string" ? data.resepsiyon : "",
          };
        });
        roomRequestDocIdsRef.current = docIds;
        setRoomRequests(nextReqs);
        markPartLoaded();
      },
      (err) => {
        setBannerMsg({ type: "error", text: "Firestore room_requests dinleme hatası oluştu." });
        handleFirestoreError(err, OperationType.LIST, "room_requests");
      }
    );

    const applyExchangeRateDocData = (data: Record<string, unknown>) => {
      const loadedRateType: TcmbRateType =
        data.activeRateType === "FOREX_SELLING" ? "FOREX_SELLING" : "FOREX_BUYING";
      setActiveRateType(loadedRateType);

      let nextTcmbTable: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem> | null = null;
      if (
        data.tcmbRates &&
        typeof data.tcmbRates === "object" &&
        (data.tcmbRates as Record<string, unknown>).USD &&
        (data.tcmbRates as Record<string, unknown>).EUR &&
        (data.tcmbRates as Record<string, unknown>).GBP
      ) {
        const rawTbl = data.tcmbRates as Record<string, TcmbRateItem>;
        nextTcmbTable = {
          TRY: { code: "TRY", name: "TÜRK LİRASI", forexBuying: 1, forexSelling: 1 },
          USD: {
            code: "USD",
            name: String(rawTbl.USD.name || "ABD DOLARI").slice(0, 64),
            forexBuying: Number(rawTbl.USD.forexBuying) || 34.821,
            forexSelling: Number(rawTbl.USD.forexSelling) || 34.8837,
          },
          EUR: {
            code: "EUR",
            name: String(rawTbl.EUR.name || "EURO").slice(0, 64),
            forexBuying: Number(rawTbl.EUR.forexBuying) || 37.452,
            forexSelling: Number(rawTbl.EUR.forexSelling) || 37.5194,
          },
          GBP: {
            code: "GBP",
            name: String(rawTbl.GBP.name || "İNGİLİZ STERLİNİ").slice(0, 64),
            forexBuying: Number(rawTbl.GBP.forexBuying) || 44.151,
            forexSelling: Number(rawTbl.GBP.forexSelling) || 44.3812,
          },
        };
        setTcmbRatesTable(nextTcmbTable);
      }

      if (
        data.exchangeRates &&
        typeof data.exchangeRates === "object" &&
        typeof (data.exchangeRates as Record<string, unknown>).EUR === "number" &&
        typeof (data.exchangeRates as Record<string, unknown>).USD === "number" &&
        typeof (data.exchangeRates as Record<string, unknown>).GBP === "number"
      ) {
        const rawRates = data.exchangeRates as Record<string, unknown>;
        const nextRates: ExchangeRatesMap = nextTcmbTable
          ? {
              TRY: 1,
              EUR:
                loadedRateType === "FOREX_BUYING"
                  ? nextTcmbTable.EUR.forexBuying
                  : nextTcmbTable.EUR.forexSelling,
              USD:
                loadedRateType === "FOREX_BUYING"
                  ? nextTcmbTable.USD.forexBuying
                  : nextTcmbTable.USD.forexSelling,
              GBP:
                loadedRateType === "FOREX_BUYING"
                  ? nextTcmbTable.GBP.forexBuying
                  : nextTcmbTable.GBP.forexSelling,
            }
          : {
              TRY: Number(rawRates.TRY) || 1,
              EUR: Number(rawRates.EUR),
              USD: Number(rawRates.USD),
              GBP: Number(rawRates.GBP),
            };

        if (!nextTcmbTable) {
          setTcmbRatesTable({
            TRY: { code: "TRY", name: "TÜRK LİRASI", forexBuying: 1, forexSelling: 1 },
            USD: {
              code: "USD",
              name: "ABD DOLARI",
              forexBuying: nextRates.USD,
              forexSelling: nextRates.USD,
            },
            EUR: {
              code: "EUR",
              name: "EURO",
              forexBuying: nextRates.EUR,
              forexSelling: nextRates.EUR,
            },
            GBP: {
              code: "GBP",
              name: "İNGİLİZ STERLİNİ",
              forexBuying: nextRates.GBP,
              forexSelling: nextRates.GBP,
            },
          });
        }

        const rDate =
          typeof data.ratesDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.ratesDate)
            ? data.ratesDate
            : null;
        settingsRatesDateRef.current = rDate;
        setExchangeRates(nextRates);
        setRatesMeta({
          date: rDate || String(data.activeBusinessDate || realToday),
          bulletinDate:
            typeof data.ratesBulletinDate === "string" ? data.ratesBulletinDate : "—",
          source: typeof data.ratesSource === "string" ? data.ratesSource : "TCMB",
          updatedAt: typeof data.ratesUpdatedAt === "string" ? data.ratesUpdatedAt : "",
        });
      }
    };

    const unsubSettings = onSnapshot(
      doc(db, "pms_settings", settingsDocId),
      (snap) => {
        if (snap.exists()) {
          settingsDocExistsRef.current = true;
          const data = snap.data();
          if (
            data.rollback20261113Done === true &&
            typeof data.activeBusinessDate === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(data.activeBusinessDate)
          ) {
            setActiveBusinessDate(data.activeBusinessDate);
          }

          if (!exchangeRatesDocExistsRef.current && data.exchangeRates) {
            applyExchangeRateDocData(data);
          }
        } else {
          settingsDocExistsRef.current = false;
        }
        setSettingsSyncedTick((prev) => prev + 1);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `pms_settings/${settingsDocId}`);
      }
    );

    const unsubExchangeRates = onSnapshot(
      doc(db, "pms_settings", "exchange_rates"),
      (snap) => {
        if (snap.exists()) {
          exchangeRatesDocExistsRef.current = true;
          applyExchangeRateDocData(snap.data());
        } else {
          exchangeRatesDocExistsRef.current = false;
          settingsRatesDateRef.current = null;
        }
        setExchangeRatesSyncedTick((prev) => prev + 1);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, "pms_settings/exchange_rates");
      }
    );

    const unsubEodLogs = onSnapshot(
      eodQ,
      (snapshot) => {
        const nextReports: EndOfDayReport[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: String(data.id || d.id),
              businessDate: String(data.businessDate || ""),
              nextBusinessDate: String(data.nextBusinessDate || ""),
              closedAt: String(data.closedAt || ""),
              closedBy: String(data.closedBy || ""),
              totalRooms: Number(data.totalRooms) || 20,
              occupiedRooms: Number(data.occupiedRooms) || 0,
              occupancyRate: Number(data.occupancyRate) || 0,
              availableRooms: Number(data.availableRooms) || 0,
              blockedRooms: Number(data.blockedRooms) || 0,
              cleanRooms: Number(data.cleanRooms) || 0,
              dirtyRooms: Number(data.dirtyRooms) || 0,
              arrivalsRealized: Number(data.arrivalsRealized) || 0,
              arrivalsPending: Number(data.arrivalsPending) || 0,
              departuresCompleted: Number(data.departuresCompleted) || 0,
              departuresPending: Number(data.departuresPending) || 0,
              roomRevenue: Number(data.roomRevenue) || 0,
              extraChargesRevenue: Number(data.extraChargesRevenue) || 0,
              collectedPayments: Number(data.collectedPayments) || 0,
              pendingBalance: Number(data.pendingBalance) || 0,
              adr: Number(data.adr) || 0,
              revPar: Number(data.revPar) || 0,
              categoryBreakdown: Array.isArray(data.categoryBreakdown) ? data.categoryBreakdown : [],
              guestSnapshots: Array.isArray(data.guestSnapshots) ? data.guestSnapshots : [],
            };
          })
          .sort((a, b) => {
            if (b.businessDate !== a.businessDate) {
              return b.businessDate.localeCompare(a.businessDate);
            }
            return b.id.localeCompare(a.id);
          });
        setEodReports(nextReports);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, "end_of_day_logs");
      }
    );

    return () => {
      cancelled = true;
      unsubRooms();
      unsubReservations();
      unsubRoomRequests();
      unsubSettings();
      unsubExchangeRates();
      unsubEodLogs();
    };
  }, [authReady, currentUser, realToday, seedYesterday, seedTomorrow, seedNext3Days]);

  const computeActiveRatesMap = (
    tbl: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem>,
    rateType: TcmbRateType
  ): ExchangeRatesMap => ({
    TRY: 1,
    EUR: Number(
      (rateType === "FOREX_BUYING" ? tbl.EUR.forexBuying : tbl.EUR.forexSelling).toFixed(4)
    ),
    USD: Number(
      (rateType === "FOREX_BUYING" ? tbl.USD.forexBuying : tbl.USD.forexSelling).toFixed(4)
    ),
    GBP: Number(
      (rateType === "FOREX_BUYING" ? tbl.GBP.forexBuying : tbl.GBP.forexSelling).toFixed(4)
    ),
  });

  // TCMB Döviz Kuru Çekme ve Firestore'a Kaydetme Yardımcıları
  const fetchTcmbRatesFromApi = async (
    rateTypeOverride?: TcmbRateType
  ): Promise<{
    rates: ExchangeRatesMap;
    tcmbTable: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem>;
    bulletinDate: string;
    source: string;
    errorMessage?: undefined;
  } | { errorMessage: string }> => {
    try {
      const response = await fetch("/api/tcmb-rates", { cache: "no-store" });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        source?: string;
        bulletinDate?: string;
        rates?: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem>;
      };
      if (!response.ok || data?.success === false || !data?.rates) {
        throw new Error(data?.error || `TCMB kur API hatası: HTTP ${response.status}`);
      }
      const { USD, EUR, GBP } = data.rates;
      if (
        !USD ||
        !EUR ||
        !GBP ||
        !Number.isFinite(USD.forexBuying) ||
        USD.forexBuying <= 0 ||
        !Number.isFinite(USD.forexSelling) ||
        USD.forexSelling <= 0 ||
        !Number.isFinite(EUR.forexBuying) ||
        EUR.forexBuying <= 0 ||
        !Number.isFinite(EUR.forexSelling) ||
        EUR.forexSelling <= 0 ||
        !Number.isFinite(GBP.forexBuying) ||
        GBP.forexBuying <= 0 ||
        !Number.isFinite(GBP.forexSelling) ||
        GBP.forexSelling <= 0
      ) {
        throw new Error("TCMB kur verileri geçersiz");
      }

      const cleanTable: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem> = {
        TRY: { code: "TRY", name: "TÜRK LİRASI", forexBuying: 1, forexSelling: 1 },
        USD: {
          code: "USD",
          name: String(USD.name || "ABD DOLARI").slice(0, 64),
          forexBuying: Number(Number(USD.forexBuying).toFixed(4)),
          forexSelling: Number(Number(USD.forexSelling).toFixed(4)),
        },
        EUR: {
          code: "EUR",
          name: String(EUR.name || "EURO").slice(0, 64),
          forexBuying: Number(Number(EUR.forexBuying).toFixed(4)),
          forexSelling: Number(Number(EUR.forexSelling).toFixed(4)),
        },
        GBP: {
          code: "GBP",
          name: String(GBP.name || "İNGİLİZ STERLİNİ").slice(0, 64),
          forexBuying: Number(Number(GBP.forexBuying).toFixed(4)),
          forexSelling: Number(Number(GBP.forexSelling).toFixed(4)),
        },
      };
      const effectiveType = rateTypeOverride ?? activeRateType;

      return {
        rates: computeActiveRatesMap(cleanTable, effectiveType),
        tcmbTable: cleanTable,
        bulletinDate: String(data.bulletinDate || formatTrDate(systemToday)).slice(0, 64),
        source: String(data.source || "TCMB").slice(0, 32),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen TCMB bağlantı hatası";
      console.warn("TCMB kurları alınamadı:", msg);
      return { errorMessage: msg };
    }
  };

  const persistExchangeRatesToFirestore = async (params: {
    nextRates: ExchangeRatesMap;
    nextTcmbTable: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem>;
    rateType: TcmbRateType;
    targetDate: string;
    bulletinDate: string;
    source: string;
  }) => {
    if (!currentUser) return;
    const { nextRates, nextTcmbTable, rateType, targetDate, bulletinDate, source } = params;
    const sanitizedRates: ExchangeRatesMap = {
      TRY: 1,
      EUR: Math.min(10000, Math.max(0.0001, Number(nextRates.EUR.toFixed(4)))),
      USD: Math.min(10000, Math.max(0.0001, Number(nextRates.USD.toFixed(4)))),
      GBP: Math.min(10000, Math.max(0.0001, Number(nextRates.GBP.toFixed(4)))),
    };
    const updatedAtLabel = formatNowTimestamp().slice(0, 64);
    const cleanBulletin = (bulletinDate || formatTrDate(targetDate)).slice(0, 64);
    const cleanSource = (source || "TCMB").slice(0, 32);

    settingsRatesDateRef.current = targetDate;
    setActiveRateType(rateType);
    setTcmbRatesTable(nextTcmbTable);
    setExchangeRates(sanitizedRates);
    setRatesMeta({
      date: targetDate,
      bulletinDate: cleanBulletin,
      source: cleanSource,
      updatedAt: updatedAtLabel,
    });

    const exchangeRatesRef = doc(db, "pms_settings", "exchange_rates");
    try {
      if (exchangeRatesDocExistsRef.current) {
        await updateDoc(exchangeRatesRef, {
          activeBusinessDate: targetDate,
          exchangeRates: sanitizedRates,
          activeRateType: rateType,
          tcmbRates: nextTcmbTable,
          ratesDate: targetDate,
          ratesBulletinDate: cleanBulletin,
          ratesSource: cleanSource,
          ratesUpdatedAt: updatedAtLabel,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(exchangeRatesRef, {
          id: "exchange_rates",
          activeBusinessDate: targetDate,
          rollback20261113Done: true,
          exchangeRates: sanitizedRates,
          activeRateType: rateType,
          tcmbRates: nextTcmbTable,
          ratesDate: targetDate,
          ratesBulletinDate: cleanBulletin,
          ratesSource: cleanSource,
          ratesUpdatedAt: updatedAtLabel,
          ownerId: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        exchangeRatesDocExistsRef.current = true;
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "pms_settings/exchange_rates");
    }
  };

  const handleRefreshTcmbRates = async (showBanner: boolean = true) => {
    if (!currentUser || isFetchingRates) return;
    setIsFetchingRates(true);
    try {
      const fetched = await fetchTcmbRatesFromApi();
      if ("rates" in fetched) {
        autoFetchedDateRef.current = systemToday;
        await persistExchangeRatesToFirestore({
          nextRates: fetched.rates,
          nextTcmbTable: fetched.tcmbTable,
          rateType: activeRateType,
          targetDate: systemToday,
          bulletinDate: fetched.bulletinDate,
          source: fetched.source,
        });
        if (showBanner) {
          setBannerMsg({
            type: "info",
            text: `TCMB (${fetched.bulletinDate}) kurları başarıyla aktarıldı: USD Alış ${fetched.tcmbTable.USD.forexBuying.toFixed(
              4
            )} / Satış ${fetched.tcmbTable.USD.forexSelling.toFixed(4)} • EUR Alış ${fetched.tcmbTable.EUR.forexBuying.toFixed(
              4
            )} / Satış ${fetched.tcmbTable.EUR.forexSelling.toFixed(4)}.`,
          });
        }
      } else if (showBanner) {
        setBannerMsg({
          type: "error",
          text: `TCMB XML bağlantısı sağlanamadı (${fetched.errorMessage}). Mevcut aktif kurlar korunuyor.`,
        });
      }
    } finally {
      setIsFetchingRates(false);
    }
  };

  const handleChangeActiveRateType = async (nextType: TcmbRateType) => {
    const nextRates = computeActiveRatesMap(tcmbRatesTable, nextType);
    await persistExchangeRatesToFirestore({
      nextRates,
      nextTcmbTable: tcmbRatesTable,
      rateType: nextType,
      targetDate: ratesMeta.date || systemToday,
      bulletinDate: ratesMeta.bulletinDate || formatTrDate(systemToday),
      source: ratesMeta.source || "TCMB",
    });
    setBannerMsg({
      type: "info",
      text: `Hesaplama baz kuru "${
        nextType === "FOREX_BUYING" ? "Döviz Alış (ForexBuying)" : "Döviz Satış (ForexSelling)"
      }" olarak güncellendi. Yeni Check-In işlemleri bu kur üzerinden sabitlenecektir.`,
    });
  };

  // Yeni bir güne başlandığında (veya aktif PMS günü için kur henüz çekilmemişse) otomatik TCMB kuru çek
  useEffect(() => {
    if (
      !authReady ||
      !currentUser ||
      !firestoreLoaded ||
      settingsSyncedTick === 0 ||
      exchangeRatesSyncedTick === 0
    ) {
      return;
    }
    if (settingsRatesDateRef.current === systemToday) return;
    if (autoFetchedDateRef.current === systemToday) return;

    autoFetchedDateRef.current = systemToday;
    let cancelled = false;

    const syncDailyTcmbRates = async () => {
      setIsFetchingRates(true);
      try {
        const fetched = await fetchTcmbRatesFromApi();
        if (!cancelled && "rates" in fetched) {
          await persistExchangeRatesToFirestore({
            nextRates: fetched.rates,
            nextTcmbTable: fetched.tcmbTable,
            rateType: activeRateType,
            targetDate: systemToday,
            bulletinDate: fetched.bulletinDate,
            source: fetched.source,
          });
        }
      } finally {
        if (!cancelled) {
          setIsFetchingRates(false);
        }
      }
    };

    void syncDailyTcmbRates();
    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    currentUser,
    firestoreLoaded,
    systemToday,
    settingsSyncedTick,
    exchangeRatesSyncedTick,
  ]);

  const handleGoogleLogin = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Google oturumu açılamadı.");
    } finally {
      setAuthBusy(false);
    }
  };

  // Modal State'leri
  const [resModal, setResModal] = useState<{
    isOpen: boolean;
    mode: "CREATE" | "EDIT";
    target: Reservation | null;
  }>({ isOpen: false, mode: "CREATE", target: null });

  const [rackModalRoomNumber, setRackModalRoomNumber] = useState<string | null>(null);
  const [historyPanelRoomNumber, setHistoryPanelRoomNumber] = useState<string | null>(null);
  const [guestHistoryOpen, setGuestHistoryOpen] = useState(false);
  const [guestHistoryQuery, setGuestHistoryQuery] = useState("");
  const [onlyDirtyRack, setOnlyDirtyRack] = useState(false);
  const [onlyLockedRack, setOnlyLockedRack] = useState(false);
  const [roomStatusLogs, setRoomStatusLogs] = useState<RoomStatusLogEntry[]>(() => {
    const todayTr = formatTrDate(getSystemTodayISO());
    return [
      {
        id: "LOG-INIT-5",
        roomNumber: "4301",
        changeType: "ROOM_LOCK",
        fromValue: "AÇIK",
        toValue: "KİLİTLİ",
        actionLabel: "Oda yetkili kullanıcı tarafından kilitlendi (Otel Müdürü)",
        timestamp: `${todayTr} · 10:20:00`,
        source: "Inhouse / Rack",
      },
      {
        id: "LOG-INIT-1",
        roomNumber: "4102",
        changeType: "CLEANLINESS",
        fromValue: "TEMİZ",
        toValue: "KİRLİ",
        actionLabel: "Check-Out sonrası oda kirli işaretlendi (BURAK ÖZKAN)",
        timestamp: `${todayTr} · 09:45:00`,
        source: "Due Outs Check-Out",
      },
      {
        id: "LOG-INIT-2",
        roomNumber: "4105",
        changeType: "PHYSICAL_STATUS",
        fromValue: "AVAILABLE",
        toValue: "OUT_OF_ORDER",
        actionLabel: "Fiziksel durum değiştirildi (Teknik bakım)",
        timestamp: `${todayTr} · 08:30:00`,
        source: "Oda Operasyon Kartı",
      },
      {
        id: "LOG-INIT-3",
        roomNumber: "4204",
        changeType: "PHYSICAL_STATUS",
        fromValue: "AVAILABLE",
        toValue: "CLOSED_TO_SALES",
        actionLabel: "Fiziksel durum değiştirildi (Satışa kapatıldı)",
        timestamp: `${todayTr} · 08:15:00`,
        source: "Oda Operasyon Kartı",
      },
      {
        id: "LOG-INIT-4",
        roomNumber: "4401",
        changeType: "PHYSICAL_STATUS",
        fromValue: "AVAILABLE",
        toValue: "OUT_OF_ORDER",
        actionLabel: "Fiziksel durum değiştirildi (Tesisat bakımı)",
        timestamp: `${todayTr} · 07:50:00`,
        source: "Oda Operasyon Kartı",
      },
    ];
  });
  const [dailyRateLogs, setDailyRateLogs] = useState<DailyRateLogEntry[]>(() => {
    const todayTr = formatTrDate(getSystemTodayISO());
    const yesterdayTr = formatTrDate(addDaysISO(getSystemTodayISO(), -1));
    return [
      {
        id: "RATE-INIT-1",
        categoryId: "CAT-1",
        categoryName: "Sea View Deluxe King",
        oldRate: 4200,
        newRate: 4500,
        changedBy: "Otel Müdürü",
        changedByRole: "MANAGER",
        timestamp: `${todayTr} · 09:15:00`,
        source: "Dashboard Kategori Ayarları",
      },
      {
        id: "RATE-INIT-2",
        categoryId: "CAT-2",
        categoryName: "City View Deluxe King",
        oldRate: 3800,
        newRate: 4000,
        changedBy: "Otel Müdürü",
        changedByRole: "MANAGER",
        timestamp: `${yesterdayTr} · 16:40:00`,
        source: "Dashboard Kategori Ayarları",
      },
      {
        id: "RATE-INIT-3",
        categoryId: "CAT-5",
        categoryName: "Sea View Deluxe Twin",
        oldRate: 4000,
        newRate: 4300,
        changedBy: "Otel Müdürü",
        changedByRole: "MANAGER",
        timestamp: `${yesterdayTr} · 11:20:00`,
        source: "Rezervasyon Kartı Kategori Ayarları",
      },
    ];
  });
  const handleRecordRateChange = (
    categoryId: string,
    oldRate: number,
    newRate: number,
    source: string = "Dashboard Kategori Ayarları"
  ) => {
    if (oldRate === newRate) return;
    const catName = categories.find((c) => c.id === categoryId)?.name || "Tanımsız";
    const roleCfg = USER_ROLES[currentUserRole];
    setDailyRateLogs((prev) => [
      {
        id: `RATE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        categoryId,
        categoryName: catName,
        oldRate,
        newRate,
        changedBy: roleCfg.shortLabel,
        changedByRole: currentUserRole,
        timestamp: formatNowTimestamp(),
        source,
      },
      ...prev,
    ]);
  };
  const [errorPopup, setErrorPopup] = useState<{
    title: string;
    message: string;
    details?: string[];
  } | null>(null);
  const [draftTeknik, setDraftTeknik] = useState("");
  const [draftHk, setDraftHk] = useState("");
  const [draftResepsiyon, setDraftResepsiyon] = useState("");
  const [postServiceNote, setPostServiceNote] = useState("");
  const [postAmount, setPostAmount] = useState("");

  // Arama, Filtre, Sıralama State'leri
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("ALL");
  const [paymentFilter, setPaymentFilter] = useState<"ALL" | PaymentStatus>("ALL");
  const [onlyMultiRoom, setOnlyMultiRoom] = useState(false);
  const [sortField, setSortField] = useState<SortField>("checkIn");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [rackFilter, setRackFilter] = useState<RackDisplayStatus | "ALL">("ALL");

  const getCategoryName = (catId: string) =>
    categories.find((c) => c.id === catId)?.name || "Tanımsız";

  // END OF DAY -> AKTİF GÜNÜ KALICI OLARAK KAPAT, SNAPSHOT KAYDET, YENİ GÜNE GEÇ VE TCMB KURLARINI ÇEK
  const handleExecuteEndOfDay = async () => {
    if (!currentUser || isClosingDay) return;
    setIsClosingDay(true);
    setEodSyncLog(null);
    setEodSyncError(null);

    const closingDate = systemToday;
    const nextDay = addDaysISO(closingDate, 1);
    const reportId = `EOD-${closingDate}-${Date.now()}`;
    const isBootstrappedAdmin = currentUser.email === "ajmagichands@gmail.com";
    const settingsDocId = isBootstrappedAdmin ? "stayflow_active" : currentUser.uid;
    const closedByLabel = `${USER_ROLES[currentUserRole].shortLabel}${
      currentUser.email ? ` (${currentUser.email})` : ""
    }`.slice(0, 120);

    const snapshot = buildEndOfDaySnapshot({
      id: reportId,
      businessDate: closingDate,
      nextBusinessDate: nextDay,
      closedAt: formatNowTimestamp(),
      closedBy: closedByLabel,
      rooms,
      reservations,
      categories,
    });

    try {
      // 1. Önce TCMB kurlarını çek (Mevcut INHOUSE odaların Check-In kurları sabit kalır!)
      const fetched = await fetchTcmbRatesFromApi();
      const nextDayTable = "rates" in fetched ? fetched.tcmbTable : tcmbRatesTable;
      const nextDayRates = "rates" in fetched ? fetched.rates : exchangeRates;
      const nextDayBulletin = (
        "rates" in fetched ? fetched.bulletinDate : ratesMeta.bulletinDate || formatTrDate(nextDay)
      ).slice(0, 64);
      const nextDaySource = ("rates" in fetched ? fetched.source : ratesMeta.source || "VARSAYILAN").slice(
        0,
        32
      );
      const ratesUpdatedAtLabel = formatNowTimestamp().slice(0, 64);

      const syncSuccessMsg =
        "rates" in fetched
          ? `TCMB (${nextDayBulletin}) kurları başarıyla aktarıldı: USD Alış ${nextDayTable.USD.forexBuying.toFixed(
              4
            )} / Satış ${nextDayTable.USD.forexSelling.toFixed(4)} • EUR Alış ${nextDayTable.EUR.forexBuying.toFixed(
              4
            )} / Satış ${nextDayTable.EUR.forexSelling.toFixed(4)}`
          : null;
      const syncErrMsg =
        "errorMessage" in fetched
          ? `TCMB XML bağlantısı sağlanamadı (${fetched.errorMessage}). Sistem güvenlik gereği bir önceki günün kurlarıyla devam edecektir.`
          : null;

      setEodSyncLog(syncSuccessMsg);
      setEodSyncError(syncErrMsg);

      const batch = writeBatch(db);
      batch.set(doc(db, "end_of_day_logs", reportId), {
        ...snapshot,
        ownerId: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const nextSettingsRatesFields = {
        exchangeRates: nextDayRates,
        activeRateType,
        tcmbRates: nextDayTable,
        ratesDate: nextDay,
        ratesBulletinDate: nextDayBulletin,
        ratesSource: nextDaySource,
        ratesUpdatedAt: ratesUpdatedAtLabel,
      };

      if (settingsDocExistsRef.current) {
        batch.update(doc(db, "pms_settings", settingsDocId), {
          activeBusinessDate: nextDay,
          lastClosedDate: closingDate,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(doc(db, "pms_settings", settingsDocId), {
          id: settingsDocId,
          activeBusinessDate: nextDay,
          lastClosedDate: closingDate,
          rollback20261113Done: true,
          ownerId: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const exchangeRatesRef = doc(db, "pms_settings", "exchange_rates");
      if (exchangeRatesDocExistsRef.current) {
        batch.update(exchangeRatesRef, {
          activeBusinessDate: nextDay,
          ...nextSettingsRatesFields,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(exchangeRatesRef, {
          id: "exchange_rates",
          activeBusinessDate: nextDay,
          rollback20261113Done: true,
          ...nextSettingsRatesFields,
          ownerId: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      settingsDocExistsRef.current = true;
      exchangeRatesDocExistsRef.current = true;
      settingsRatesDateRef.current = nextDay;
      autoFetchedDateRef.current = nextDay;
      setTcmbRatesTable(nextDayTable);
      setExchangeRates(nextDayRates);
      setRatesMeta({
        date: nextDay,
        bulletinDate: nextDayBulletin,
        source: nextDaySource,
        updatedAt: ratesUpdatedAtLabel,
      });
      setActiveBusinessDate(nextDay);
      setSelectedEodReportId(reportId);
      setIsEodModalOpen(false);
      setEodCompletedPopup({
        closedDate: closingDate,
        nextDate: nextDay,
        report: snapshot,
        newDayRates: nextDayRates,
        newDayTcmbTable: nextDayTable,
        newDayBulletinDate: nextDayBulletin,
        newDayRateSource: nextDaySource,
        syncLog: syncSuccessMsg,
        syncError: syncErrMsg,
      });
      setBannerMsg({
        type: "info",
        text: `${formatTrDate(closingDate)} gün sonu kapaması Firestore'a kaydedildi. Yeni aktif PMS günü: ${formatTrDate(
          nextDay
        )} · ${nextDaySource} kurları güncellendi.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "End of Day gün kapama işlemi Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.WRITE, `end_of_day_logs/${reportId}`);
    } finally {
      setIsClosingDay(false);
    }
  };

  // ==========================================================================
  // İŞ KURALLARI (BUSINESS LOGIC)
  // ==========================================================================

  const handleSaveReservation = async (saved: Reservation, isNew: boolean) => {
    if (!currentUser) return;

    // 0. Kilitli oda koruması (Resepsiyon personeli oda tipi, oda no ve misafir bilgisi değiştiremez)
    if (currentUserRole === "RECEPTION") {
      const existingRes = !isNew ? reservations.find((r) => r.id === saved.id) : undefined;
      const origRoom = existingRes?.roomNumber
        ? rooms.find((rm) => rm.roomNumber === existingRes.roomNumber)
        : undefined;
      const targetRoom = saved.roomNumber
        ? rooms.find((rm) => rm.roomNumber === saved.roomNumber)
        : undefined;

      if (origRoom?.isLocked && existingRes) {
        const guestChanged =
          saved.firstName !== existingRes.firstName || saved.lastName !== existingRes.lastName;
        const categoryChanged = saved.categoryId !== existingRes.categoryId;
        const roomChanged = saved.roomNumber !== existingRes.roomNumber;

        if (guestChanged || categoryChanged || roomChanged) {
          setErrorPopup({
            title: "ODA KİLİTLİ — RESEPSİYON DÜZENLEMESİ ENGELLENDİ",
            message: `Oda ${origRoom.roomNumber} yetkili kullanıcı tarafından kilitlendiği için resepsiyon personeli tarafından oda tipi değişikliği, oda değişimi veya misafir bilgisi düzenlemesi yapılamaz.`,
            details: [
              `Kilitli Oda: ${origRoom.roomNumber}`,
              `Kilitleyen Yetkili: ${origRoom.lockedBy || "Otel Müdürü"}`,
              `Aktif Kullanıcı Rolü: ${USER_ROLES[currentUserRole].label}`,
            ],
          });
          return;
        }
      }

      if (targetRoom?.isLocked && saved.roomNumber !== existingRes?.roomNumber) {
        setErrorPopup({
          title: "ODA KİLİTLİ — ATAMA ENGELLENDİ",
          message: `Oda ${targetRoom.roomNumber} kilitli olduğu için resepsiyon personeli tarafından bu odaya rezervasyon ataması veya oda tipi düzenlemesi yapılamaz.`,
          details: [
            `Kilitli Oda: ${targetRoom.roomNumber}`,
            `Kilitleyen Yetkili: ${targetRoom.lockedBy || "Otel Müdürü"}`,
          ],
        });
        return;
      }
    }

    // 1. Giriş - Çıkış tarih tutarlılığı kontrolü
    if (saved.checkIn >= saved.checkOut) {
      setErrorPopup({
        title: "GEÇERSİZ TARİH ARALIĞI",
        message:
          "Çıkış tarihi giriş tarihinden en az 1 gün sonra olmalıdır. Değişiklik kaydedilmedi.",
        details: [
          `Giriş Tarihi: ${formatTrDate(saved.checkIn)}`,
          `Çıkış Tarihi: ${formatTrDate(saved.checkOut)}`,
        ],
      });
      return;
    }

    // 2. RESERVATION <-> INHOUSE tarih çakışma kontrolü (Değişiklik/ekleme engellenir)
    if (saved.roomNumber) {
      const inhouseConflict = reservations.find(
        (other) =>
          other.id !== saved.id &&
          other.lifecycle === "INHOUSE" &&
          other.roomNumber === saved.roomNumber &&
          saved.checkIn < other.checkOut &&
          other.checkIn < saved.checkOut
      );

      if (inhouseConflict) {
        setErrorPopup({
          title: "TARİH ÇAKIŞMASI — DEĞİŞİKLİK ENGELLENDİ",
          message: `Oda ${saved.roomNumber} için girilen tarihler (${formatTrDate(saved.checkIn)} – ${formatTrDate(saved.checkOut)}), INHOUSE modülündeki aktif konaklama tarihleri ile çakışıyor. Değişiklik yapılmasına izin verilmedi.`,
          details: [
            `Çakışan Oda: ${saved.roomNumber}`,
            `INHOUSE Misafir: ${inhouseConflict.firstName} ${inhouseConflict.lastName} (${inhouseConflict.resCode})`,
            `INHOUSE Tarihleri: ${formatTrDate(inhouseConflict.checkIn)} – ${formatTrDate(inhouseConflict.checkOut)}`,
          ],
        });
        return;
      }

      // INHOUSE kaydı düzenleniyorsa, mevcut CONFIRMED rezervasyonlarla tarih çakışmasını da engelle
      if (saved.lifecycle === "INHOUSE") {
        const resConflict = reservations.find(
          (other) =>
            other.id !== saved.id &&
            other.lifecycle === "CONFIRMED" &&
            other.roomNumber === saved.roomNumber &&
            saved.checkIn < other.checkOut &&
            other.checkIn < saved.checkOut
        );

        if (resConflict) {
          setErrorPopup({
            title: "TARİH ÇAKIŞMASI — DEĞİŞİKLİK ENGELLENDİ",
            message: `Oda ${saved.roomNumber} için güncellenen INHOUSE tarihleri (${formatTrDate(saved.checkIn)} – ${formatTrDate(saved.checkOut)}), RESERVATION modülündeki başka bir rezervasyon ile çakışıyor. Değişiklik kaydedilmedi.`,
            details: [
              `Çakışan Oda: ${saved.roomNumber}`,
              `Rezervasyon: ${resConflict.firstName} ${resConflict.lastName} (${resConflict.resCode})`,
              `Rezervasyon Tarihleri: ${formatTrDate(resConflict.checkIn)} – ${formatTrDate(resConflict.checkOut)}`,
            ],
          });
          return;
        }
      }
    }

    const resPath = `reservations/${saved.id}`;
    try {
      if (isNew) {
        await setDoc(doc(db, "reservations", saved.id), buildReservationCreatePayload(saved, currentUser.uid));
      } else {
        await updateDoc(doc(db, "reservations", saved.id), {
          roomNumber: saved.roomNumber ?? null,
          firstName: saved.firstName,
          lastName: saved.lastName,
          checkIn: saved.checkIn,
          checkOut: saved.checkOut,
          nights: Math.max(1, Math.round(saved.nights)),
          categoryId: saved.categoryId,
          paymentStatus: saved.paymentStatus,
          paidAmount: Number(saved.paidAmount) || 0,
          totalAmount: Number(saved.totalAmount) || 0,
          notes: saved.notes || "",
          updatedAt: serverTimestamp(),
        });
      }
      setResModal({ isOpen: false, mode: "CREATE", target: null });
      setBannerMsg({
        type: "info",
        text: isNew
          ? `${saved.resCode} (${saved.firstName} ${saved.lastName}) rezervasyonu Firestore'a kaydedildi.`
          : `${saved.resCode} rezervasyon kaydı Firestore'da güncellendi.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Rezervasyon Firestore'a kaydedilemedi." });
      handleFirestoreError(err, isNew ? OperationType.CREATE : OperationType.UPDATE, resPath);
    }
  };

  // REZERVASYON KARTI -> AKTİF REZERVASYONU İPTAL ET (İPTAL NEDENİ İLE)
  const handleCancelReservation = async (
    res: Reservation,
    cancellationReason: string
  ) => {
    if (!currentUser) return;
    const trimmedReason = cancellationReason.trim().slice(0, 500);
    if (!trimmedReason) return;
    if (res.lifecycle !== "CONFIRMED" && res.lifecycle !== "INHOUSE") return;

    const roleCfg = USER_ROLES[currentUserRole];
    const nowTs = formatNowTimestamp();
    const resPath = `reservations/${res.id}`;

    try {
      await updateDoc(doc(db, "reservations", res.id), {
        lifecycle: "CANCELLED",
        cancellationReason: trimmedReason,
        cancelledAt: nowTs.slice(0, 64),
        cancelledBy: roleCfg.shortLabel.slice(0, 64),
        updatedAt: serverTimestamp(),
      });

      setResModal({ isOpen: false, mode: "CREATE", target: null });
      setBannerMsg({
        type: "info",
        text: `${res.resCode} (${res.firstName} ${res.lastName}) rezervasyonu iptal edildi. Neden: "${trimmedReason}"`,
      });
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: "Rezervasyon iptal işlemi Firestore'a yazılamadı.",
      });
      handleFirestoreError(err, OperationType.UPDATE, resPath);
    }
  };

  // ARRIVALS / RESERVATION -> CHECK IN
  const handleCheckIn = async (res: Reservation) => {
    if (!res.roomNumber) {
      setErrorPopup({
        title: "ODA ATANMAMIŞ — CHECK-IN YAPILAMAZ",
        message: `${res.firstName} ${res.lastName} (${res.resCode}) için henüz oda numarası atanmamış. Rezervasyon kartından oda seçip kaydedin.`,
      });
      setResModal({ isOpen: true, mode: "EDIT", target: res });
      return;
    }

    const roomObj = rooms.find((rm) => rm.roomNumber === res.roomNumber);
    if (!roomObj) {
      setErrorPopup({
        title: "GEÇERSİZ ODA NUMARASI",
        message: `${res.roomNumber} numaralı oda otel tanımlı odalar (4101–4405) arasında bulunamadı.`,
      });
      return;
    }

    // INHOUSE modülünde halen aktif olan bir oda için CHECK-IN engelle (POP-UP HATA)
    const occupiedByOther = reservations.find(
      (other) =>
        other.id !== res.id &&
        other.lifecycle === "INHOUSE" &&
        other.roomNumber === res.roomNumber
    );
    if (occupiedByOther) {
      setErrorPopup({
        title: "CHECK-IN ENGELLENDİ — ODA INHOUSE MODÜLÜNDE AKTİF",
        message: `Oda ${res.roomNumber} şu anda INHOUSE modülünde halen aktif konaklama durumunda olduğu için Check-In işlemine izin verilmiyor.`,
        details: [
          `Oda No: ${res.roomNumber}`,
          `Aktif INHOUSE Misafir: ${occupiedByOther.firstName} ${occupiedByOther.lastName} (${occupiedByOther.resCode})`,
          `Konaklama Tarihleri: ${formatTrDate(occupiedByOther.checkIn)} – ${formatTrDate(occupiedByOther.checkOut)}`,
        ],
      });
      return;
    }

    if (roomObj.physicalStatus !== "AVAILABLE") {
      setErrorPopup({
        title: "CHECK-IN ENGELLENDİ — ODA SATIŞA KAPALI",
        message: `Oda ${res.roomNumber} şu anda "${
          roomObj.physicalStatus === "OUT_OF_ORDER" ? "OUT OF ORDER" : "CLOSED TO SALES"
        }" durumunda olduğu için Check-In yapılamaz.`,
      });
      return;
    }

    if (res.checkIn > systemToday) {
      setErrorPopup({
        title: "CHECK-IN ENGELLENDİ — GİRİŞ TARİHİ UYUMSUZ",
        message: `Bu rezervasyonun giriş tarihi (${formatTrDate(res.checkIn)}) bugünden (${formatTrDate(systemToday)}) ileri bir tarih olduğu için Check-In yapılamaz.`,
      });
      return;
    }

    const nowTime = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    const resPath = `reservations/${res.id}`;
    const activeMapForCheckIn = computeActiveRatesMap(tcmbRatesTable, activeRateType);
    const rateBasisLabel = activeRateType === "FOREX_BUYING" ? "Alış" : "Satış";
    const sourceTag = `${ratesMeta.source === "MANUEL" ? "MANUEL" : "TCMB"} (${rateBasisLabel})`.slice(
      0,
      32
    );
    const lockedRates: LockedExchangeRates = {
      TRY: 1,
      EUR: Math.min(10000, Math.max(0.0001, Number(activeMapForCheckIn.EUR.toFixed(4)))),
      USD: Math.min(10000, Math.max(0.0001, Number(activeMapForCheckIn.USD.toFixed(4)))),
      GBP: Math.min(10000, Math.max(0.0001, Number(activeMapForCheckIn.GBP.toFixed(4)))),
      lockedDate: systemToday,
      bulletinDate: (ratesMeta.bulletinDate || formatTrDate(systemToday)).slice(0, 64),
      source: sourceTag,
    };

    try {
      await updateDoc(doc(db, "reservations", res.id), {
        lifecycle: "INHOUSE",
        checkedInAt: nowTime,
        checkInRates: lockedRates,
        updatedAt: serverTimestamp(),
      });
      setBannerMsg({
        type: "info",
        text: `Oda ${res.roomNumber} — ${res.firstName} ${res.lastName} Check-In tamamlandı (${nowTime}). Giriş kuru sabitlendi: EUR ${lockedRates.EUR.toFixed(
          4
        )} · USD ${lockedRates.USD.toFixed(4)} TL.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Check-In işlemi Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.UPDATE, resPath);
    }
  };

  const handleUndoCheckIn = async (res: Reservation) => {
    const resPath = `reservations/${res.id}`;
    try {
      await updateDoc(doc(db, "reservations", res.id), {
        lifecycle: "CONFIRMED",
        checkedInAt: deleteField(),
        checkInRates: deleteField(),
        updatedAt: serverTimestamp(),
      });
      setBannerMsg({
        type: "info",
        text: `${res.resCode} (${res.firstName} ${res.lastName}) Check-In geri alındı (Firestore güncellendi).`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Check-In geri alma işlemi Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.UPDATE, resPath);
    }
  };

  // DUE OUTS -> ÖDEME AL NOTU İLE EŞLEŞEN CHECK OUT AKSİYONU (ATOMİK BATCH YAZIM)
  const handleCheckOut = async (res: Reservation, collectedNow: number = 0) => {
    const remainingBalance = Math.max(0, res.totalAmount - res.paidAmount);
    const updatedPaidAmount = res.paidAmount + collectedNow;

    // Toplam ödeme ile örtüşme kontrolü
    if (remainingBalance > 0 && updatedPaidAmount < res.totalAmount) {
      setBannerMsg({
        type: "error",
        text: `Oda ${res.roomNumber} için kalan ödeme (${remainingBalance.toLocaleString("tr-TR")} TL) tam olarak tahsil edilmeden Check-Out yapılamaz!`,
      });
      return;
    }

    const nowTime = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    const resPath = `reservations/${res.id}`;
    const targetRoom = res.roomNumber
      ? rooms.find((rm) => rm.roomNumber === res.roomNumber)
      : undefined;

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "reservations", res.id), {
        paidAmount: updatedPaidAmount,
        paymentStatus: "ODENDI",
        lifecycle: "CHECKED_OUT",
        checkedOutAt: nowTime,
        updatedAt: serverTimestamp(),
      });

      if (res.roomNumber && targetRoom) {
        batch.update(doc(db, "rooms", res.roomNumber), {
          isDirty: true,
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      // Ödeme giriş kutusunu temizle
      setDueOutPaymentInputs((prev) => {
        const copy = { ...prev };
        delete copy[res.id];
        return copy;
      });

      if (res.roomNumber && targetRoom && !targetRoom.isDirty) {
        setRoomStatusLogs((prev) => [
          {
            id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            roomNumber: res.roomNumber!,
            changeType: "CLEANLINESS",
            fromValue: "TEMİZ",
            toValue: "KİRLİ",
            actionLabel: `Check-Out sonrası oda kirli işaretlendi (${res.firstName} ${res.lastName})`,
            timestamp: formatNowTimestamp(),
            source: "Due Outs Check-Out",
          },
          ...prev,
        ]);
      }

      setBannerMsg({
        type: "info",
        text: `Oda ${res.roomNumber} — ${res.firstName} ${res.lastName} Check-Out Firestore'a yazıldı (${nowTime}). Oda kirli olarak işaretlendi.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Check-Out işlemi Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.WRITE, resPath);
    }
  };

  // ERKEN ÇIKIŞ ÖNİZLEME HESABI:
  // Yapılan ödeme (paidAmount) sabit kalır; günlük ADR değişmez; kalmadığı her gece FOLYO POST kalemi olarak işlenir.
  const computeEarlyCheckOutPreview = (res: Reservation) => {
    const originalTotalNights =
      res.nights > 0 ? res.nights : calculateNights(res.checkIn, res.checkOut);
    const startMs = parseISOLocal(res.checkIn).getTime();
    const todayMs = parseISOLocal(systemToday).getTime();
    const rawDiffDays = Math.round((todayMs - startMs) / (1000 * 60 * 60 * 24));
    const rawStayedNights = Math.max(0, rawDiffDays);
    const effectiveStayedNights = Math.min(
      originalTotalNights,
      Math.max(1, rawStayedNights)
    );
    const unusedNights = Math.max(0, originalTotalNights - effectiveStayedNights);

    const existingExtraSum = (res.extraCharges || []).reduce(
      (acc, item) => acc + (Number(item.amount) || 0),
      0
    );
    const originalAccommodationTotal = Math.max(
      0,
      (Number(res.totalAmount) || 0) - existingExtraSum
    );
    const nightlyRate =
      originalTotalNights > 0
        ? Math.round(originalAccommodationTotal / originalTotalNights)
        : 0;
    const usedAccommodationTotal =
      originalTotalNights > 0
        ? Math.round(
            (originalAccommodationTotal * effectiveStayedNights) / originalTotalNights
          )
        : 0;
    const unusedAccommodationTotal = Math.max(
      0,
      originalAccommodationTotal - usedAccommodationTotal
    );

    const roleCfg = USER_ROLES[currentUserRole];
    const postedAt = formatNowTimestamp();
    const unusedEntries: FolioPostEntry[] = [];
    if (unusedNights > 0 && unusedAccommodationTotal > 0) {
      let allocated = 0;
      for (let i = 0; i < unusedNights; i++) {
        const nightDate = addDaysISO(res.checkIn, effectiveStayedNights + i);
        const remainingToAllocate = Math.max(0, unusedAccommodationTotal - allocated);
        const amount =
          i === unusedNights - 1
            ? remainingToAllocate
            : Math.min(remainingToAllocate, Math.max(1, nightlyRate));
        if (amount > 0) {
          allocated += amount;
          unusedEntries.push({
            id: `EARLY-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
            serviceNote: `ERKEN ÇIKIŞ ODA BEDELİ (${formatTrDate(nightDate)})`.slice(0, 120),
            amount,
            postedAt,
            postedBy: roleCfg.shortLabel.slice(0, 64),
          });
        }
      }
    }

    const unusedPostedSum = unusedEntries.reduce((s, e) => s + e.amount, 0);
    const totalAfterPost = usedAccommodationTotal + existingExtraSum + unusedPostedSum;
    const paidAmountFixed = Number(res.paidAmount) || 0;
    const balanceAfterPost = Math.max(0, totalAfterPost - paidAmountFixed);

    return {
      originalTotalNights,
      rawStayedNights,
      effectiveStayedNights,
      unusedNights,
      nightlyRate,
      existingExtraSum,
      usedAccommodationTotal,
      unusedAccommodationTotal: unusedPostedSum,
      unusedEntries,
      totalAfterPost,
      paidAmountFixed,
      balanceAfterPost,
    };
  };

  const openEarlyCheckOutModal = (res: Reservation) => {
    setEarlyCheckOutTarget(res);
    setEarlyCheckOutCollectionInput("");
  };

  // ERKEN ÇIKIŞ AŞAMA 1 (Action 8A): Ödemeyi (paidAmount) HİÇ DEĞİŞTİRMEDEN kalmadığı geceleri POST eder ve çıkışı bugüne çeker.
  const handlePostUnusedNightsOnly = async (res: Reservation) => {
    if (isSubmittingEarlyCheckOut) return;
    if (res.lifecycle !== "INHOUSE" || res.checkOut <= systemToday) return;

    const preview = computeEarlyCheckOutPreview(res);
    const nextCharges = [...(res.extraCharges || []), ...preview.unusedEntries];
    if (nextCharges.length > 400) {
      setErrorPopup({
        title: "FOLYO LİMİTİ AŞILDI",
        message: "Bir rezervasyon folyosuna en fazla 400 POST kalemi eklenebilir.",
      });
      return;
    }

    const nextPaymentStatus: PaymentStatus =
      preview.paidAmountFixed >= preview.totalAfterPost && preview.totalAfterPost > 0
        ? "ODENDI"
        : preview.paidAmountFixed > 0
          ? "KISMI_ODENDI"
          : "ODENMEDI";

    setIsSubmittingEarlyCheckOut(true);
    const resPath = `reservations/${res.id}`;
    try {
      await updateDoc(doc(db, "reservations", res.id), {
        checkOut: systemToday,
        nights: preview.effectiveStayedNights,
        extraCharges: nextCharges,
        totalAmount: preview.totalAfterPost,
        paymentStatus: nextPaymentStatus,
        updatedAt: serverTimestamp(),
      });

      setEarlyCheckOutTarget(null);
      setEarlyCheckOutCollectionInput("");
      setBannerMsg({
        type: "info",
        text: `Oda ${res.roomNumber} erken çıkış işlemi için kalmadığı ${preview.unusedNights} gecenin bedeli (+${preview.unusedAccommodationTotal.toLocaleString("tr-TR")} TL) POST edildi. Yapılan ödeme (${preview.paidAmountFixed.toLocaleString("tr-TR")} TL) sabit kaldı; kalan BALANCE: ${preview.balanceAfterPost.toLocaleString("tr-TR")} TL.`,
      });
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: "Erken çıkış geceleme POST işlemi Firestore'a yazılamadı.",
      });
      handleFirestoreError(err, OperationType.UPDATE, resPath);
    } finally {
      setIsSubmittingEarlyCheckOut(false);
    }
  };

  // ERKEN ÇIKIŞ AŞAMA 2 (Action 8B): Kalmadığı geceler POST edilir ve yalnızca BALANCE === 0 olduğunda Check-Out tamamlanır.
  const handleConfirmEarlyCheckOut = async (
    res: Reservation,
    extraCollectedRaw: number = 0
  ) => {
    if (isSubmittingEarlyCheckOut) return;
    if (res.lifecycle !== "INHOUSE") return;

    const preview = computeEarlyCheckOutPreview(res);
    const extraCollected = Math.max(0, Number(extraCollectedRaw) || 0);
    const finalPaidAmount = Number((preview.paidAmountFixed + extraCollected).toFixed(2));
    const finalBalance = Math.max(0, preview.totalAfterPost - finalPaidAmount);

    if (finalBalance > 0) {
      setBannerMsg({
        type: "error",
        text: `Oda ${res.roomNumber} için BALANCE (${finalBalance.toLocaleString("tr-TR")} TL) sıfır olmadan Check-Out yapılamaz!`,
      });
      return;
    }

    const nextCharges = [...(res.extraCharges || []), ...preview.unusedEntries];
    if (nextCharges.length > 400) {
      setErrorPopup({
        title: "FOLYO LİMİTİ AŞILDI",
        message: "Bir rezervasyon folyosuna en fazla 400 POST kalemi eklenebilir.",
      });
      return;
    }

    const nowTime = new Date().toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const resPath = `reservations/${res.id}`;
    const targetRoom = res.roomNumber
      ? rooms.find((rm) => rm.roomNumber === res.roomNumber)
      : undefined;

    setIsSubmittingEarlyCheckOut(true);
    try {
      const batch = writeBatch(db);
      const updatePayload: Record<string, unknown> = {
        checkOut: systemToday,
        nights: preview.effectiveStayedNights,
        extraCharges: nextCharges,
        totalAmount: preview.totalAfterPost,
        paymentStatus: "ODENDI",
        lifecycle: "CHECKED_OUT",
        checkedOutAt: nowTime,
        updatedAt: serverTimestamp(),
      };
      if (extraCollected > 0) {
        updatePayload.paidAmount = finalPaidAmount;
      }

      batch.update(doc(db, "reservations", res.id), updatePayload);

      if (res.roomNumber && targetRoom) {
        batch.update(doc(db, "rooms", res.roomNumber), {
          isDirty: true,
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      if (res.roomNumber && targetRoom && !targetRoom.isDirty) {
        setRoomStatusLogs((prev) => [
          {
            id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            roomNumber: res.roomNumber!,
            changeType: "CLEANLINESS",
            fromValue: "TEMİZ",
            toValue: "KİRLİ",
            actionLabel: `Erken Check-Out sonrası oda kirli işaretlendi (${res.firstName} ${res.lastName})`,
            timestamp: formatNowTimestamp(),
            source: "Erken Çıkış Check-Out",
          },
          ...prev,
        ]);
      }

      setEarlyCheckOutTarget(null);
      setEarlyCheckOutCollectionInput("");
      setBannerMsg({
        type: "info",
        text: `Oda ${res.roomNumber} (${res.firstName} ${res.lastName}) Erken Check-Out tamamlandı (${nowTime}). ${
          preview.unusedNights > 0
            ? `Kalmadığı ${preview.unusedNights} gece POST edildi, `
            : ""
        }günlük ADR (${preview.nightlyRate.toLocaleString("tr-TR")} TL) korundu ve BALANCE: 0 TL ile çıkış verildi.`,
      });
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: "Erken Check-Out işlemi Firestore'a yazılamadı.",
      });
      handleFirestoreError(err, OperationType.WRITE, resPath);
    } finally {
      setIsSubmittingEarlyCheckOut(false);
    }
  };

  const handleUndoCheckOut = async (res: Reservation) => {
    const resPath = `reservations/${res.id}`;
    try {
      await updateDoc(doc(db, "reservations", res.id), {
        lifecycle: "INHOUSE",
        checkedOutAt: deleteField(),
        updatedAt: serverTimestamp(),
      });
      setBannerMsg({
        type: "info",
        text: `${res.resCode} (${res.firstName} ${res.lastName}) Check-Out geri alındı (Firestore güncellendi).`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Check-Out geri alma işlemi Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.UPDATE, resPath);
    }
  };

  // INHOUSE / RACK -> ODA FİZİKSEL DURUMU DEĞİŞTİRME (OUT OF ORDER / CLOSED TO SALES / AVAILABLE - SOLVED)
  const handleSetRoomPhysicalStatus = async (
    roomNumber: string,
    newStatus: RoomPhysicalStatus,
    source: string = "Oda Operasyon Kartı"
  ) => {
    const currentRoom = rooms.find((rm) => rm.roomNumber === roomNumber);
    if (!currentRoom || currentRoom.physicalStatus === newStatus) return;

    const prevStatus = currentRoom.physicalStatus;
    const roomPath = `rooms/${roomNumber}`;
    try {
      await updateDoc(doc(db, "rooms", roomNumber), {
        physicalStatus: newStatus,
        updatedAt: serverTimestamp(),
      });

      setRoomStatusLogs((prev) => [
        {
          id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          roomNumber,
          changeType: "PHYSICAL_STATUS",
          fromValue: prevStatus,
          toValue: newStatus,
          actionLabel:
            newStatus === "AVAILABLE" && prevStatus === "OUT_OF_ORDER"
              ? `OUT OF ORDER arızası çözüldü (SOLVED) → AVAILABLE`
              : `Fiziksel durum ${prevStatus} → ${newStatus} olarak değiştirildi`,
          timestamp: formatNowTimestamp(),
          source,
        },
        ...prev,
      ]);

      setBannerMsg({
        type: "info",
        text:
          newStatus === "AVAILABLE" && prevStatus === "OUT_OF_ORDER"
            ? `Oda ${roomNumber} arızası çözüldü (SOLVED) ve satışa açıldı (Firestore güncellendi).`
            : `Oda ${roomNumber} durumu ${newStatus} olarak Firestore'a yazıldı.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Oda fiziksel durumu Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.UPDATE, roomPath);
    }
  };

  const handleToggleRoomDirty = async (
    roomNumber: string,
    source: string = "Rack / Housekeeping"
  ) => {
    const currentRoom = rooms.find((rm) => rm.roomNumber === roomNumber);
    if (!currentRoom) return;

    const wasDirty = Boolean(currentRoom.isDirty);
    const nextDirty = !wasDirty;
    const roomPath = `rooms/${roomNumber}`;

    try {
      await updateDoc(doc(db, "rooms", roomNumber), {
        isDirty: nextDirty,
        updatedAt: serverTimestamp(),
      });

      setRoomStatusLogs((prev) => [
        {
          id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          roomNumber,
          changeType: "CLEANLINESS",
          fromValue: wasDirty ? "KİRLİ" : "TEMİZ",
          toValue: nextDirty ? "KİRLİ" : "TEMİZ",
          actionLabel: nextDirty
            ? "Oda kirli olarak işaretlendi"
            : "Oda temizlendi (hazır)",
          timestamp: formatNowTimestamp(),
          source,
        },
        ...prev,
      ]);
    } catch (err) {
      setBannerMsg({ type: "error", text: "Oda temizlik durumu Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.UPDATE, roomPath);
    }
  };

  // INHOUSE / RACK -> ODA KİLİTLEME / KİLİT AÇMA (YETKİ KONTROLLÜ)
  const handleToggleRoomLock = async (
    roomNumber: string,
    source: string = "Inhouse / Rack"
  ) => {
    const roleCfg = USER_ROLES[currentUserRole];
    if (!roleCfg.canLockRoom) {
      setErrorPopup({
        title: "YETKİ HATASI — ODA KİLİTLEME ENGELLENDİ",
        message: `Oda ${roomNumber} için kilitleme veya kilit açma işlemi yalnızca ilgili yetkiye sahip kullanıcılar (Otel Müdürü) tarafından yapılabilir.`,
        details: [
          `Aktif Rol: ${roleCfg.label}`,
          "Gerekli Yetki: Otel Müdürü (Kilit Yetkili)",
        ],
      });
      return;
    }

    const targetRoom = rooms.find((rm) => rm.roomNumber === roomNumber);
    if (!targetRoom) return;

    const wasLocked = Boolean(targetRoom.isLocked);
    const nextLocked = !wasLocked;
    const nowTs = formatNowTimestamp();
    const roomPath = `rooms/${roomNumber}`;

    try {
      await updateDoc(
        doc(db, "rooms", roomNumber),
        nextLocked
          ? {
              isLocked: true,
              lockedBy: roleCfg.shortLabel,
              lockedAt: nowTs,
              updatedAt: serverTimestamp(),
            }
          : {
              isLocked: false,
              lockedBy: deleteField(),
              lockedAt: deleteField(),
              updatedAt: serverTimestamp(),
            }
      );

      setRoomStatusLogs((prev) => [
        {
          id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          roomNumber,
          changeType: "ROOM_LOCK",
          fromValue: wasLocked ? "KİLİTLİ" : "AÇIK",
          toValue: nextLocked ? "KİLİTLİ" : "AÇIK",
          actionLabel: nextLocked
            ? `Oda kilitlendi (${roleCfg.shortLabel}) — Resepsiyon oda tipi ve misafir düzenlemesi engellendi`
            : `Oda kilidi açıldı (${roleCfg.shortLabel})`,
          timestamp: nowTs,
          source,
        },
        ...prev,
      ]);

      setBannerMsg({
        type: "info",
        text: nextLocked
          ? `Oda ${roomNumber} kilitlendi (${roleCfg.shortLabel}). Kilitli odada resepsiyon personeli oda tipi ve misafir bilgisini değiştiremez.`
          : `Oda ${roomNumber} kilidi açıldı.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Oda kilit durumu Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.UPDATE, roomPath);
    }
  };

  // INHOUSE / RACK Çift Tıklama Operasyon Kartı
  const handleOpenRackCard = (room: HotelRoom) => {
    const reqs = roomRequests[room.roomNumber] || { teknik: "", hk: "", resepsiyon: "" };
    setDraftTeknik(reqs.teknik);
    setDraftHk(reqs.hk);
    setDraftResepsiyon(reqs.resepsiyon);
    setPostServiceNote("");
    setPostAmount("");
    setRackModalRoomNumber(room.roomNumber);
  };

  // INHOUSE / RACK -> MİSAFİR FOLYOSUNA EKSTRA HİZMET & BEDEL POST ETME
  const handlePostRoomCharge = async (
    reservation: Reservation,
    serviceNoteInput: string,
    amountInput: string
  ) => {
    const trimmedNote = serviceNoteInput.trim();
    const numericAmount = Math.round(Number(amountInput));

    if (!trimmedNote) {
      setErrorPopup({
        title: "HİZMET - PORT ALANI BOŞ BIRAKILAMAZ",
        message: "Lütfen POST edilecek hizmet veya harcama açıklamasını girin (örn: LAUNDRY HİZMETİ).",
      });
      return;
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorPopup({
        title: "GEÇERSİZ BEDEL",
        message: "Lütfen POST işlemi için 0 TL'den büyük geçerli bir bedel girin (örn: 2400 veya 3600).",
      });
      return;
    }

    const roleCfg = USER_ROLES[currentUserRole];
    const newEntry: FolioPostEntry = {
      id: `POST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      serviceNote: trimmedNote.toLocaleUpperCase("tr-TR"),
      amount: numericAmount,
      postedAt: formatNowTimestamp(),
      postedBy: roleCfg.shortLabel,
    };

    const nextTotal = reservation.totalAmount + numericAmount;
    const nextPaymentStatus: PaymentStatus =
      reservation.paidAmount >= nextTotal && nextTotal > 0
        ? "ODENDI"
        : reservation.paidAmount > 0
          ? "KISMI_ODENDI"
          : "ODENMEDI";
    const nextRemaining = Math.max(0, nextTotal - reservation.paidAmount);
    const nextCharges = [...(reservation.extraCharges || []), newEntry];
    const resPath = `reservations/${reservation.id}`;

    try {
      await updateDoc(doc(db, "reservations", reservation.id), {
        extraCharges: nextCharges,
        totalAmount: nextTotal,
        paymentStatus: nextPaymentStatus,
        updatedAt: serverTimestamp(),
      });

      setPostServiceNote("");
      setPostAmount("");
      setBannerMsg({
        type: "info",
        text: `Oda ${reservation.roomNumber} (${reservation.firstName} ${reservation.lastName}) folyosuna "${newEntry.serviceNote}" (+${numericAmount.toLocaleString("tr-TR")} TL) POST edildi. Çıkışta ödenecek kalan tutar: ${nextRemaining.toLocaleString("tr-TR")} TL.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "POST harcaması Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.UPDATE, resPath);
    }
  };

  const getEffectiveCheckInRatesForRes = (res: Reservation): LockedExchangeRates => {
    if (res.checkInRates) return res.checkInRates;
    const activeMap = computeActiveRatesMap(tcmbRatesTable, activeRateType);
    const rateBasisLabel = activeRateType === "FOREX_BUYING" ? "Alış" : "Satış";
    return {
      TRY: 1,
      EUR: Math.min(10000, Math.max(0.0001, Number(activeMap.EUR.toFixed(4)))),
      USD: Math.min(10000, Math.max(0.0001, Number(activeMap.USD.toFixed(4)))),
      GBP: Math.min(10000, Math.max(0.0001, Number(activeMap.GBP.toFixed(4)))),
      lockedDate: res.checkIn,
      bulletinDate: (ratesMeta.bulletinDate || formatTrDate(res.checkIn)).slice(0, 64),
      source: `${ratesMeta.source === "MANUEL" ? "MANUEL" : "TCMB"} (${rateBasisLabel})`.slice(
        0,
        32
      ),
    };
  };

  // INHOUSE / RACK -> CHECK-IN GÜNÜ DÖVİZ / TL ÖDEMESİNİ KİLİTLİ KURLA FIRESTORE'A KAYDET
  const handleSaveRackCheckInPayment = async (reservation: Reservation) => {
    if (!currentUser || savingRackPaymentId) return;
    const draft = rackPaymentDrafts[reservation.id] ?? {
      amount: reservation.checkInPayment ? String(reservation.checkInPayment.amount) : "",
      currency: reservation.checkInPayment?.currency ?? ("USD" as PaymentCurrency),
    };
    const numericAmount = Number(Number(draft.amount).toFixed(2));
    if (!draft.amount.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorPopup({
        title: "GEÇERSİZ ÖDEME MİKTARI",
        message: `Oda ${reservation.roomNumber || "—"} için Check-In günü ödeme tutarını 0'dan büyük bir değer olarak girin (örn: 1200.00).`,
      });
      return;
    }

    const currency = draft.currency;
    const lockedRates = getEffectiveCheckInRatesForRes(reservation);
    const lockedRate =
      currency === "TRY"
        ? 1
        : Math.min(10000, Math.max(0.0001, Number(lockedRates[currency].toFixed(4))));
    const tlAmount = Number((numericAmount * lockedRate).toFixed(2));

    const prevCheckInTl = reservation.checkInPayment?.tlAmount ?? 0;
    const basePriorPaid = Math.max(0, Number((reservation.paidAmount - prevCheckInTl).toFixed(2)));
    const nextPaidAmount = Number((basePriorPaid + tlAmount).toFixed(2));
    const nextPaymentStatus: PaymentStatus =
      nextPaidAmount >= reservation.totalAmount && reservation.totalAmount > 0
        ? "ODENDI"
        : nextPaidAmount > 0
          ? "KISMI_ODENDI"
          : "ODENMEDI";

    const roleCfg = USER_ROLES[currentUserRole];
    const checkInPaymentPayload: CheckInPaymentEntry = {
      amount: numericAmount,
      currency,
      lockedRate,
      tlAmount,
      lockedDate: lockedRates.lockedDate,
      savedAt: formatNowTimestamp().slice(0, 64),
      savedBy: roleCfg.shortLabel.slice(0, 64),
    };

    const resPath = `reservations/${reservation.id}`;
    setSavingRackPaymentId(reservation.id);
    try {
      await updateDoc(doc(db, "reservations", reservation.id), {
        checkInPayment: checkInPaymentPayload,
        checkInRates: lockedRates,
        paidAmount: nextPaidAmount,
        paymentStatus: nextPaymentStatus,
        updatedAt: serverTimestamp(),
      });

      setRackPaymentDrafts((prev) => ({
        ...prev,
        [reservation.id]: {
          amount: numericAmount.toFixed(2),
          currency,
        },
      }));

      setBannerMsg({
        type: "info",
        text: `Oda ${reservation.roomNumber} (${reservation.firstName} ${reservation.lastName}) Check-In ödemesi kaydedildi: ${formatForeignCurrencyValue(
          numericAmount,
          currency
        )} = ${tlAmount.toLocaleString("tr-TR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} TL (${formatTrDate(lockedRates.lockedDate)} kuru ${lockedRate.toFixed(4)} TL ile kilitlendi).`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Check-In ödemesi Firestore'a kaydedilemedi." });
      handleFirestoreError(err, OperationType.UPDATE, resPath);
    } finally {
      setSavingRackPaymentId(null);
    }
  };

  const handleRemoveRoomCharge = async (reservation: Reservation, chargeId: string) => {
    const target = (reservation.extraCharges || []).find((c) => c.id === chargeId);
    if (!target) return;

    const nextCharges = (reservation.extraCharges || []).filter((c) => c.id !== chargeId);
    const nextTotal = Math.max(0, reservation.totalAmount - target.amount);
    const nextPaymentStatus: PaymentStatus =
      reservation.paidAmount >= nextTotal && nextTotal > 0
        ? "ODENDI"
        : reservation.paidAmount > 0
          ? "KISMI_ODENDI"
          : "ODENMEDI";
    const resPath = `reservations/${reservation.id}`;

    try {
      await updateDoc(doc(db, "reservations", reservation.id), {
        extraCharges: nextCharges,
        totalAmount: nextTotal,
        paymentStatus: nextPaymentStatus,
        updatedAt: serverTimestamp(),
      });

      setBannerMsg({
        type: "info",
        text: `Oda ${reservation.roomNumber} "${target.serviceNote}" (-${target.amount.toLocaleString("tr-TR")} TL) POST kaydı iptal edildi.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "POST iptal işlemi Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.UPDATE, resPath);
    }
  };

  const handleSaveRoomReq = async (type: keyof RoomRequests, val: string) => {
    if (!rackModalRoomNumber || !currentUser) return;
    const reqPath = `room_requests/${rackModalRoomNumber}`;
    const current = roomRequests[rackModalRoomNumber] || { teknik: "", hk: "", resepsiyon: "" };
    const updated: RoomRequests = { ...current, [type]: val.trim() };

    try {
      if (roomRequestDocIdsRef.current.has(rackModalRoomNumber)) {
        await updateDoc(doc(db, "room_requests", rackModalRoomNumber), {
          [type]: val.trim(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, "room_requests", rackModalRoomNumber), {
          roomNumber: rackModalRoomNumber,
          teknik: updated.teknik,
          hk: updated.hk,
          resepsiyon: updated.resepsiyon,
          ownerId: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      setBannerMsg({
        type: "info",
        text: `Oda ${rackModalRoomNumber} departman notu Firestore'a kaydedildi.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Departman notu Firestore'a yazılamadı." });
      handleFirestoreError(err, OperationType.WRITE, reqPath);
    }
  };

  const handleDeleteRoomReq = async (type: keyof RoomRequests, solvedLabel: boolean = false) => {
    if (!rackModalRoomNumber) return;
    const reqPath = `room_requests/${rackModalRoomNumber}`;
    const current = roomRequests[rackModalRoomNumber] || { teknik: "", hk: "", resepsiyon: "" };
    const next: RoomRequests = { ...current, [type]: "" };
    const allEmpty = !next.teknik && !next.hk && !next.resepsiyon;

    try {
      if (roomRequestDocIdsRef.current.has(rackModalRoomNumber)) {
        if (allEmpty) {
          await deleteDoc(doc(db, "room_requests", rackModalRoomNumber));
        } else {
          await updateDoc(doc(db, "room_requests", rackModalRoomNumber), {
            [type]: "",
            updatedAt: serverTimestamp(),
          });
        }
      }
      if (type === "teknik") setDraftTeknik("");
      if (type === "hk") setDraftHk("");
      if (type === "resepsiyon") setDraftResepsiyon("");
      setBannerMsg({
        type: "info",
        text: solvedLabel
          ? `Oda ${rackModalRoomNumber} talebi SOLVED (çözüldü) olarak kapatıldı ve Firestore'dan temizlendi.`
          : `Oda ${rackModalRoomNumber} departman notu Firestore'dan silindi.`,
      });
    } catch (err) {
      setBannerMsg({ type: "error", text: "Departman notu Firestore'dan silinemedi." });
      handleFirestoreError(err, OperationType.DELETE, reqPath);
    }
  };

  // ==========================================================================
  // 6. HESAPLANMIŞ VERİLER VE FİLTRELEME / SIRALAMA
  // ==========================================================================
  const getRackDisplayStatus = (room: HotelRoom): RackDisplayStatus => {
    if (room.physicalStatus === "OUT_OF_ORDER") return "OUT_OF_ORDER";
    if (room.physicalStatus === "CLOSED_TO_SALES") return "CLOSED_TO_SALES";
    const activeGuest = reservations.find(
      (r) => r.lifecycle === "INHOUSE" && r.roomNumber === room.roomNumber
    );
    if (activeGuest) {
      return activeGuest.checkOut <= systemToday ? "DUE_OUT" : "INHOUSE";
    }
    return "BOS";
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-400" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3 h-3 text-sky-600" />
    ) : (
      <ArrowDown className="w-3 h-3 text-sky-600" />
    );
  };

  const moduleCounts = useMemo(() => {
    const arrivalsPending = reservations.filter(
      (r) => r.checkIn <= systemToday && r.lifecycle === "CONFIRMED"
    ).length;
    const inhouseActive = reservations.filter((r) => r.lifecycle === "INHOUSE").length;
    const dueOutsPending = reservations.filter(
      (r) => r.checkOut <= systemToday && r.lifecycle === "INHOUSE"
    ).length;
    return {
      totalRes: reservations.filter((r) => r.lifecycle !== "CANCELLED").length,
      arrivalsPending,
      inhouseActive,
      dueOutsPending,
    };
  }, [reservations, systemToday]);

  const rackStats = useMemo(() => {
    const counts: Record<RackDisplayStatus, number> = {
      INHOUSE: 0,
      BOS: 0,
      DUE_OUT: 0,
      OUT_OF_ORDER: 0,
      CLOSED_TO_SALES: 0,
    };
    let dirtyCount = 0;
    let lockedCount = 0;
    rooms.forEach((rm) => {
      const st = getRackDisplayStatus(rm);
      counts[st] += 1;
      if (rm.isDirty) dirtyCount += 1;
      if (rm.isLocked) lockedCount += 1;
    });
    return { counts, dirtyCount, lockedCount };
  }, [rooms, reservations, systemToday]);

  const filteredTableRows = useMemo(() => {
    let base: Reservation[] = [];

    if (activeModule === "RESERVATION") {
      base = reservations;
    } else if (activeModule === "ARRIVALS") {
      // RESERVATION ve ARRIVALS modülleri uyumlu giriş-çıkış tarihine (checkIn <= systemToday && checkOut > checkIn) göre senkronize görünür
      base = reservations.filter(
        (r) =>
          r.checkIn < r.checkOut &&
          r.lifecycle !== "CHECKED_OUT" &&
          r.lifecycle !== "CANCELLED" &&
          (r.checkIn === systemToday || (r.lifecycle === "CONFIRMED" && r.checkIn <= systemToday))
      );
    } else if (activeModule === "DUE_OUTS") {
      base = reservations.filter(
        (r) =>
          (r.lifecycle === "INHOUSE" && r.checkOut <= systemToday) ||
          (r.lifecycle === "CHECKED_OUT" && r.checkOut === systemToday)
      );
    }

    const q = searchQuery.trim().toLocaleLowerCase("tr-TR");
    const filtered = base.filter((row) => {
      if (q) {
        const fullName = `${row.firstName} ${row.lastName}`.toLocaleLowerCase("tr-TR");
        const roomStr = (row.roomNumber || "").toLocaleLowerCase("tr-TR");
        const codeStr = row.resCode.toLocaleLowerCase("tr-TR");
        const catStr = getCategoryName(row.categoryId).toLocaleLowerCase("tr-TR");
        if (
          !fullName.includes(q) &&
          !roomStr.includes(q) &&
          !codeStr.includes(q) &&
          !catStr.includes(q)
        ) {
          return false;
        }
      }

      if (activeModule === "RESERVATION" && dateFilter !== "ALL") {
        if (dateFilter === "TODAY_IN" && row.checkIn !== systemToday) return false;
        if (dateFilter === "TODAY_OUT" && row.checkOut !== systemToday) return false;
        if (dateFilter === "TOMORROW_IN" && row.checkIn !== nextBusinessDate) return false;
      }

      if (paymentFilter !== "ALL" && row.paymentStatus !== paymentFilter) return false;
      if (onlyMultiRoom && !row.groupId) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "resCode") cmp = a.resCode.localeCompare(b.resCode);
      else if (sortField === "roomNumber")
        cmp = (a.roomNumber || "9999").localeCompare(b.roomNumber || "9999");
      else if (sortField === "guestName")
        cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, "tr-TR");
      else if (sortField === "checkIn") cmp = a.checkIn.localeCompare(b.checkIn);
      else if (sortField === "category")
        cmp = getCategoryName(a.categoryId).localeCompare(getCategoryName(b.categoryId), "tr-TR");
      else if (sortField === "paidAmount") cmp = a.paidAmount - b.paidAmount;

      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [
    activeModule,
    reservations,
    systemToday,
    nextBusinessDate,
    searchQuery,
    dateFilter,
    paymentFilter,
    onlyMultiRoom,
    sortField,
    sortDirection,
    categories,
  ]);

  const financialSummary = useMemo(() => {
    const totalExpected = reservations.reduce((acc, r) => acc + r.totalAmount, 0);
    const totalCollected = reservations.reduce((acc, r) => acc + r.paidAmount, 0);
    const totalRemaining = Math.max(0, totalExpected - totalCollected);
    const dirtyRooms = rooms.filter((rm) => rm.isDirty).map((rm) => rm.roomNumber);
    return { totalExpected, totalCollected, totalRemaining, dirtyRooms };
  }, [reservations, rooms]);

  const activeRackRoom = useMemo(
    () => rooms.find((rm) => rm.roomNumber === rackModalRoomNumber) || null,
    [rooms, rackModalRoomNumber]
  );

  const activeRackGuest = useMemo(() => {
    if (!rackModalRoomNumber) return null;
    return (
      reservations.find(
        (r) => r.lifecycle === "INHOUSE" && r.roomNumber === rackModalRoomNumber
      ) || null
    );
  }, [reservations, rackModalRoomNumber]);

  // ==========================================================================
  // 7. ARAYÜZ (UI RENDER)
  // ==========================================================================
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[var(--pms-surface-bg)] flex items-center justify-center p-6">
        <div className="bg-white border border-slate-300 rounded-lg shadow-md px-6 py-5 flex items-center gap-3 text-xs font-bold text-slate-700">
          <Clock className="w-4 h-4 text-sky-600 animate-spin" />
          <span>StayFlow PMS · Cloud Firestore bağlantısı hazırlanıyor...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[var(--pms-surface-bg)] flex items-center justify-center p-6">
        <div className="bg-white border border-slate-300 rounded-lg shadow-xl max-w-md w-full overflow-hidden">
          <div className="bg-[var(--pms-header-bg)] text-[var(--pms-header-text)] px-5 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-sky-500/20 border border-sky-400/30 flex items-center justify-center shrink-0">
              <BedDouble className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h1 className="font-extrabold text-base tracking-tight">StayFlow PMS</h1>
              <p className="text-[11px] text-slate-300">
                Cloud Firestore Gerçek Zamanlı Otel Operasyon Sistemi
              </p>
            </div>
          </div>

          <div className="p-5 flex flex-col gap-4 text-xs text-slate-700">
            <p className="leading-relaxed">
              <strong>reservations</strong>, <strong>rooms</strong> ve{" "}
              <strong>room_requests</strong> koleksiyonlarını gerçek zamanlı (
              <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">onSnapshot</code>)
              senkronize etmek için Google hesabınızla oturum açın.
            </p>

            {authError && (
              <div className="p-2.5 rounded bg-rose-50 border border-rose-300 text-rose-800 font-semibold">
                {authError}
              </div>
            )}

            <button
              type="button"
              disabled={authBusy}
              onClick={handleGoogleLogin}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-md bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-extrabold text-xs tracking-wide shadow-xs cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{authBusy ? "Oturum Açılıyor..." : "Google ile Giriş Yap"}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--pms-surface-bg)] text-slate-900 flex flex-col transition-colors">
      {/* ÜST GEZİNTİ ÇUBUĞU */}
      <header className="bg-[var(--pms-header-bg)] text-[var(--pms-header-text)] border-b border-white/10 px-4 lg:px-6 py-3 no-print transition-colors">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Sol: Marka ve Sistem Tarihi */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-[var(--pms-radius)] bg-sky-500/15 border border-sky-400/30 flex items-center justify-center">
                <BedDouble className="w-4 h-4 text-sky-400" />
              </div>
              <span className="font-extrabold text-base tracking-tight whitespace-nowrap">
                StayFlow PMS
              </span>
            </div>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-300 font-medium">
              <Calendar className="w-3.5 h-3.5 text-sky-400" />
              <span>{formatTrDate(systemToday)}</span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-slate-400">20 Oda / 4 Kat</span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-md px-2 py-1">
              <UserCog className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <select
                value={currentUserRole}
                onChange={(e) => setCurrentUserRole(e.target.value as UserRole)}
                aria-label="Aktif Kullanıcı Yetkisi"
                className="bg-slate-800 text-xs font-bold text-slate-100 focus:outline-none cursor-pointer"
              >
                <option value="MANAGER">{USER_ROLES.MANAGER.label}</option>
                <option value="RECEPTION">{USER_ROLES.RECEPTION.label}</option>
              </select>
            </div>
          </div>

          {/* Orta: Entegre Modül Sekmeleri */}
          <nav className="flex items-center gap-1 bg-white/5 p-1 rounded-[var(--pms-radius)] border border-white/10">
            <button
              type="button"
              onClick={() => setActiveModule("DASHBOARD")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--pms-radius)] text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                activeModule === "DASHBOARD"
                  ? "bg-[var(--pms-accent)] text-white shadow-xs"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>DASHBOARD</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("RESERVATION")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--pms-radius)] text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                activeModule === "RESERVATION"
                  ? "bg-[var(--pms-accent)] text-white shadow-xs"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>RESERVATION</span>
              <span className="font-mono text-[11px] opacity-80">({moduleCounts.totalRes})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("ARRIVALS")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--pms-radius)] text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                activeModule === "ARRIVALS"
                  ? "bg-[var(--pms-accent)] text-white shadow-xs"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>ARRIVALS</span>
              <span className="font-mono text-[11px] opacity-80">({moduleCounts.arrivalsPending})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("INHOUSE_RACK")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--pms-radius)] text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                activeModule === "INHOUSE_RACK"
                  ? "bg-[var(--pms-accent)] text-white shadow-xs"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>INHOUSE / RACK</span>
              <span className="font-mono text-[11px] opacity-80">({moduleCounts.inhouseActive})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("DUE_OUTS")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--pms-radius)] text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                activeModule === "DUE_OUTS"
                  ? "bg-[var(--pms-accent)] text-white shadow-xs"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>DUE OUTS</span>
              <span className="font-mono text-[11px] opacity-80">({moduleCounts.dueOutsPending})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveModule("OCCUPANCY_REPORT")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--pms-radius)] text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
                activeModule === "OCCUPANCY_REPORT"
                  ? "bg-[var(--pms-accent)] text-white shadow-xs"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>OCCUPANCY REPORT</span>
            </button>
          </nav>

          {/* Sağ: Aksiyon Butonları */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveModule("END_OF_DAY");
                setEodSyncLog(null);
                setEodSyncError(null);
                setIsEodModalOpen(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold tracking-wide shadow-xs cursor-pointer transition whitespace-nowrap ${
                activeModule === "END_OF_DAY" ? "ring-2 ring-amber-300" : ""
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>GÜNÜ KAPAT (END OF DAY)</span>
            </button>

            <ThemeCustomizerDrawer />

            <button
              type="button"
              onClick={() => {
                setGuestHistoryQuery("");
                setGuestHistoryOpen(true);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold border whitespace-nowrap transition-colors cursor-pointer ${
                guestHistoryOpen
                  ? "bg-[var(--pms-accent)] border-sky-400 text-white"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Guest History</span>
            </button>

            <button
              type="button"
              onClick={() => setShowExtraModules((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold border whitespace-nowrap transition-colors cursor-pointer ${
                showExtraModules
                  ? "bg-slate-700 border-slate-500 text-white"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Özet & HK</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              title="Yazdır"
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Yazdır</span>
            </button>

            <button
              type="button"
              onClick={() => setResModal({ isOpen: true, mode: "CREATE", target: null })}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold tracking-wide whitespace-nowrap shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>YENİ REZERVASYON</span>
            </button>

            <button
              type="button"
              onClick={() => signOut(auth)}
              title={`Oturumu Kapat (${currentUser.email || ""})`}
              className="flex items-center gap-1 px-2.5 py-2 rounded-md bg-slate-800 hover:bg-rose-700 border border-slate-700 text-[11px] font-bold text-slate-300 hover:text-white whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden 2xl:inline">{currentUser.email}</span>
            </button>
          </div>
        </div>
      </header>

      {/* İSTEĞE BAĞLI EK ÖZET & HOUSEKEEPING PANELİ */}
      {showExtraModules && (
        <section className="bg-white border-b border-slate-200 px-4 lg:px-6 py-3 no-print">
          <div className="max-w-[1440px] mx-auto grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <div className="text-slate-500 font-semibold">Toplam Rezervasyon Tutarı</div>
                <div className="text-base font-extrabold text-slate-900 font-mono tabular-nums mt-0.5">
                  {financialSummary.totalExpected.toLocaleString("tr-TR")} TL
                </div>
              </div>
              <FileText className="w-5 h-5 text-slate-400" />
            </div>

            <div className="p-3 rounded-md bg-emerald-50/70 border border-emerald-200 flex items-center justify-between">
              <div>
                <div className="text-emerald-700 font-semibold">Tahsil Edilen Ödeme</div>
                <div className="text-base font-extrabold text-emerald-900 font-mono tabular-nums mt-0.5">
                  {financialSummary.totalCollected.toLocaleString("tr-TR")} TL
                </div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>

            <div className="p-3 rounded-md bg-amber-50/70 border border-amber-200 flex items-center justify-between">
              <div>
                <div className="text-amber-800 font-semibold">Bekleyen Bakiye</div>
                <div className="text-base font-extrabold text-amber-950 font-mono tabular-nums mt-0.5">
                  {financialSummary.totalRemaining.toLocaleString("tr-TR")} TL
                </div>
              </div>
              <Clock className="w-5 h-5 text-amber-600" />
            </div>

            <div className="p-3 rounded-md bg-sky-50/70 border border-sky-200 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sky-800 font-semibold">Housekeeping — Kirli Odalar</div>
                <div className="text-xs font-bold text-sky-950 truncate mt-1">
                  {financialSummary.dirtyRooms.length > 0
                    ? financialSummary.dirtyRooms.join(", ")
                    : "Tüm odalar temiz"}
                </div>
              </div>
              <Sparkles className="w-5 h-5 text-sky-600 shrink-0" />
            </div>
          </div>
        </section>
      )}

      {/* ANA İÇERİK ALANI */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 lg:px-6 py-4 flex flex-col gap-3">
        {!firestoreLoaded && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-md border border-sky-200 bg-sky-50 text-sky-900 text-xs font-semibold no-print">
            <Clock className="w-3.5 h-3.5 text-sky-600 animate-spin shrink-0" />
            <span>Cloud Firestore verileri (reservations, rooms, room_requests) senkronize ediliyor...</span>
          </div>
        )}

        {/* BİLDİRİM / HATA BANNERI */}
        {bannerMsg && (
          <div
            className={`flex items-center justify-between gap-3 px-4 py-2.5 rounded-md border text-xs font-semibold no-print ${
              bannerMsg.type === "error"
                ? "bg-rose-50 border-rose-300 text-rose-900"
                : "bg-sky-50 border-sky-300 text-sky-900"
            }`}
          >
            <div className="flex items-center gap-2">
              {bannerMsg.type === "error" ? (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
              )}
              <span>{bannerMsg.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerMsg(null)}
              className="text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================================================================ */}
        {/* MODÜL 0: DASHBOARD (OPERASYONEL ÖZET & TRENDLER)                 */}
        {/* ================================================================ */}
        {activeModule === "DASHBOARD" && (
          <>
            <DashboardModule
              rooms={rooms}
              reservations={reservations}
              categories={categories}
              systemToday={systemToday}
              dailyRateLogs={dailyRateLogs}
              onRecordRateChange={handleRecordRateChange}
              onUpdateCategoryRate={(categoryId, newRate) =>
                setCategories((prev) =>
                  prev.map((cat) =>
                    cat.id === categoryId
                      ? { ...cat, defaultRate: Math.max(0, Math.round(newRate)) }
                      : cat
                  )
                )
              }
              exchangeRates={exchangeRates}
              exchangeState={{
                bulletinDate: ratesMeta.bulletinDate,
                lastUpdatedAt: ratesMeta.updatedAt,
                activeRateType,
                rates: tcmbRatesTable,
              }}
              ratesMeta={ratesMeta}
              isFetchingRates={isFetchingRates}
              onRefreshTcmbRates={() => handleRefreshTcmbRates(true)}
              onChangeActiveRateType={handleChangeActiveRateType}
              onNavigateModule={(target) => setActiveModule(target)}
            />

            {/* SON 7 GÜN ODA DOLULUK TRENDLERİ (RECHARTS) — SADECE DASHBOARD */}
            <RoomOccupancyTrends
              reservations={reservations}
              rooms={rooms}
              categories={categories}
              systemToday={systemToday}
            />
          </>
        )}

        {/* ================================================================ */}
        {/* MODÜL 1, 2, 4: TABLO GÖRÜNÜMÜ (RESERVATION / ARRIVALS / DUE OUTS) */}
        {/* ================================================================ */}
        {activeModule !== "DASHBOARD" &&
          activeModule !== "INHOUSE_RACK" &&
          activeModule !== "OCCUPANCY_REPORT" &&
          activeModule !== "END_OF_DAY" && (
          <div className="bg-[var(--pms-card-bg)] rounded-[var(--pms-radius)] border border-slate-200 shadow-xs flex flex-col overflow-hidden">
            {/* Araç Çubuğu: Arama ve Filtreler */}
            <div className="p-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-extrabold text-slate-900 tracking-wide">
                  {activeModule === "RESERVATION" && "TÜM REZERVASYONLAR"}
                  {activeModule === "ARRIVALS" && "BUGÜN GİRİŞ YAPACAKLAR (ARRIVALS)"}
                  {activeModule === "DUE_OUTS" && "BUGÜN ÇIKIŞ YAPACAKLAR (DUE OUTS)"}
                </h1>
                <span className="text-xs text-slate-500 font-medium">
                  · {filteredTableRows.length} kayıt listeleniyor
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Arama */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="İsim, Oda No, PNR veya Tip..."
                    className="pl-8 pr-3 py-1.5 w-56 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-sky-600"
                  />
                </div>

                {/* Tarih Filtresi (Sadece Reservation modülünde) */}
                {activeModule === "RESERVATION" && (
                  <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-md px-2 py-1">
                    <Filter className="w-3 h-3 text-slate-500" />
                    <select
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                      className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-none"
                    >
                      <option value="ALL">Tüm Tarihler</option>
                      <option value="TODAY_IN">Bugün Giriş</option>
                      <option value="TODAY_OUT">Bugün Çıkış</option>
                      <option value="TOMORROW_IN">Yarın Giriş</option>
                    </select>
                  </div>
                )}

                {/* Ödeme Durumu Filtresi */}
                <select
                  value={paymentFilter}
                  onChange={(e) => setPaymentFilter(e.target.value as "ALL" | PaymentStatus)}
                  className="text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:border-sky-600"
                >
                  <option value="ALL">Tüm Ödemeler</option>
                  <option value="ODENDI">Ödendi</option>
                  <option value="KISMI_ODENDI">Kısmi Ödendi</option>
                  <option value="ODENMEDI">Ödenmedi</option>
                </select>

                {/* Çoklu Oda Filtresi */}
                <button
                  type="button"
                  onClick={() => setOnlyMultiRoom((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-bold transition-colors cursor-pointer ${
                    onlyMultiRoom
                      ? "bg-indigo-600 border-indigo-600 text-white"
                      : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Grup / Çoklu Oda</span>
                </button>
              </div>
            </div>

            {/* Veri Tablosu */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("resCode")}
                        className="flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                      >
                        <span>REZ. KODU</span>
                        {renderSortIcon("resCode")}
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("roomNumber")}
                        className="flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                      >
                        <span>ODA</span>
                        {renderSortIcon("roomNumber")}
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("guestName")}
                        className="flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                      >
                        <span>MİSAFİR</span>
                        {renderSortIcon("guestName")}
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("category")}
                        className="flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                      >
                        <span>ODA TİPİ</span>
                        {renderSortIcon("category")}
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => toggleSort("checkIn")}
                        className="flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                      >
                        <span>KONAKLAMA TARİHİ</span>
                        {renderSortIcon("checkIn")}
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort("paidAmount")}
                        className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                      >
                        <span>ÖDEME / BAKİYE</span>
                        {renderSortIcon("paidAmount")}
                      </button>
                    </th>
                    <th className="py-2.5 px-3">DURUM</th>
                    <th className="py-2.5 px-3 text-right no-print">İŞLEM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredTableRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-500">
                        <div className="flex flex-col items-center gap-2">
                          <BedDouble className="w-7 h-7 text-slate-300" />
                          <p className="text-xs font-semibold">
                            Seçili filtrelere uygun kayıt bulunamadı.
                          </p>
                          {(searchQuery || paymentFilter !== "ALL" || onlyMultiRoom || dateFilter !== "ALL") && (
                            <button
                              type="button"
                              onClick={() => {
                                setSearchQuery("");
                                setPaymentFilter("ALL");
                                setOnlyMultiRoom(false);
                                setDateFilter("ALL");
                              }}
                              className="px-3 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer"
                            >
                              Filtreleri Temizle
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredTableRows.map((row) => {
                      const remaining = Math.max(0, row.totalAmount - row.paidAmount);
                      const payStyle = PAYMENT_BADGE_STYLES[row.paymentStatus];
                      const dueInputVal = dueOutPaymentInputs[row.id] ?? "";
                      const collectedNow = Number(dueInputVal) || 0;

                      return (
                        <tr
                          key={row.id}
                          className="hover:bg-sky-50/40 transition-colors"
                        >
                          {/* Rezervasyon Kodu */}
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>{row.resCode}</span>
                              {row.groupId && (
                                <span
                                  title={`Grup Kodu: ${row.groupId}`}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold"
                                >
                                  <Layers className="w-2.5 h-2.5" />
                                  GRP
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Oda No */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {row.roomNumber ? (
                              <div className="inline-flex items-center gap-1">
                                <span className="font-mono font-extrabold text-sm text-slate-900 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded">
                                  {row.roomNumber}
                                </span>
                                {rooms.find((rm) => rm.roomNumber === row.roomNumber)?.isLocked && (
                                  <span
                                    title="Bu oda yetkili kullanıcı tarafından kilitlenmiştir"
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 border border-rose-300 text-rose-800 text-[10px] font-extrabold"
                                  >
                                    <Lock className="w-2.5 h-2.5" />
                                    <span>KİLİTLİ</span>
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                                ATANMADI
                              </span>
                            )}
                          </td>

                          {/* Misafir */}
                          <td className="py-2.5 px-3">
                            <button
                              type="button"
                              onClick={() => {
                                setGuestHistoryQuery(`${row.firstName} ${row.lastName}`);
                                setGuestHistoryOpen(true);
                              }}
                              title="Misafir geçmişini ve önceki ziyaret notlarını görüntüle"
                              className="font-bold text-slate-900 hover:text-sky-700 hover:underline text-left cursor-pointer"
                            >
                              {row.firstName} {row.lastName}
                            </button>
                            {row.notes && (
                              <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5 max-w-xs truncate">
                                <StickyNote className="w-3 h-3 text-amber-500 shrink-0" />
                                <span className="truncate">{row.notes}</span>
                              </div>
                            )}
                          </td>

                          {/* Oda Tipi */}
                          <td className="py-2.5 px-3 font-medium text-slate-700 whitespace-nowrap">
                            {getCategoryName(row.categoryId)}
                          </td>

                          {/* Konaklama Tarihi */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="font-semibold text-slate-800">
                              {formatTrDate(row.checkIn)} — {formatTrDate(row.checkOut)}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                              {row.nights} Gece
                            </div>
                          </td>

                          {/* Ödeme & Kalan Bakiye */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {(() => {
                              const extraList = row.extraCharges || [];
                              const extraSum = extraList.reduce((acc, c) => acc + c.amount, 0);
                              const baseRoomTotal = Math.max(0, row.totalAmount - extraSum);
                              const baseRoomRemaining = Math.max(0, baseRoomTotal - row.paidAmount);
                              const effectiveLockedRates: LockedExchangeRates | null =
                                row.lifecycle === "INHOUSE" || row.lifecycle === "CHECKED_OUT"
                                  ? row.checkInRates ?? {
                                      ...DEFAULT_EXCHANGE_RATES,
                                      lockedDate: row.checkIn,
                                      bulletinDate: formatTrDate(row.checkIn),
                                      source: "GİRİŞ SABİT",
                                    }
                                  : null;
                              const rateDiffersFromToday =
                                effectiveLockedRates !== null &&
                                (Math.abs(exchangeRates.EUR - effectiveLockedRates.EUR) > 0.0001 ||
                                  Math.abs(exchangeRates.USD - effectiveLockedRates.USD) > 0.0001 ||
                                  Math.abs(exchangeRates.GBP - effectiveLockedRates.GBP) > 0.0001);
                              return (
                                <>
                                  <div className="font-mono font-bold text-slate-900 tabular-nums">
                                    {row.paidAmount.toLocaleString("tr-TR")} /{" "}
                                    {row.totalAmount.toLocaleString("tr-TR")} TL
                                  </div>
                                  <div className="mt-0.5 flex items-center justify-end gap-1.5">
                                    {remaining > 0 && (
                                      <span className="text-[11px] font-bold text-rose-700 font-mono tabular-nums">
                                        Kalan: {remaining.toLocaleString("tr-TR")} TL
                                      </span>
                                    )}
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold border ${payStyle.bg} ${payStyle.text} ${payStyle.border}`}
                                    >
                                      {payStyle.label}
                                    </span>
                                  </div>
                                  {extraList.length > 0 && (
                                    <div className="mt-1.5 pt-1.5 border-t border-indigo-200/80 bg-indigo-50/80 border border-indigo-200 rounded px-2 py-1 text-left">
                                      <div className="flex items-center justify-between gap-2 text-[10px] font-extrabold text-indigo-900">
                                        <span className="inline-flex items-center gap-1">
                                          <Receipt className="w-2.5 h-2.5 text-indigo-600" />
                                          <span>POST HİZMETLER</span>
                                        </span>
                                        <span className="font-mono tabular-nums">
                                          +{extraSum.toLocaleString("tr-TR")} TL
                                        </span>
                                      </div>
                                      <div className="mt-0.5 flex flex-col gap-0.5">
                                        {extraList.map((item) => (
                                          <div
                                            key={item.id}
                                            className="flex items-center justify-between gap-2 text-[10px] text-indigo-800"
                                          >
                                            <span className="truncate max-w-[145px] font-semibold">
                                              {item.serviceNote}
                                            </span>
                                            <span className="font-mono font-bold tabular-nums shrink-0">
                                              +{item.amount.toLocaleString("tr-TR")} TL
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                      {remaining > 0 && (
                                        <div className="mt-1 pt-1 border-t border-indigo-200 flex items-center justify-between gap-2 text-[10px] font-extrabold text-rose-800">
                                          <span>
                                            Çıkışta Ödenecek
                                            {baseRoomRemaining > 0
                                              ? ` (Oda ${baseRoomRemaining.toLocaleString("tr-TR")} + POST ${extraSum.toLocaleString("tr-TR")})`
                                              : ""}
                                            :
                                          </span>
                                          <span className="font-mono tabular-nums shrink-0">
                                            {remaining.toLocaleString("tr-TR")} TL
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {row.checkInPayment && (
                                    <div
                                      className="mt-1.5 bg-teal-50/90 border border-teal-200 rounded px-2 py-1 text-left"
                                      title="INHOUSE Rack kartından girilen ve Check-In günü kurundan kilitlenen ödeme"
                                    >
                                      <div className="flex items-center justify-between gap-2 text-[10px] font-extrabold text-teal-950">
                                        <span className="inline-flex items-center gap-1">
                                          <CheckCircle2 className="w-2.5 h-2.5 text-teal-700" />
                                          <span>
                                            Check-In Ödeme ({formatTrDate(row.checkInPayment.lockedDate)})
                                          </span>
                                        </span>
                                        <span className="text-[9px] px-1 rounded bg-teal-100 text-teal-900">
                                          KUR KİLİTLİ
                                        </span>
                                      </div>
                                      <div className="mt-0.5 font-mono text-[10px] font-bold text-teal-900 tabular-nums">
                                        {formatForeignCurrencyValue(
                                          row.checkInPayment.amount,
                                          row.checkInPayment.currency
                                        )}{" "}
                                        ={" "}
                                        {row.checkInPayment.tlAmount.toLocaleString("tr-TR", {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        })}{" "}
                                        TL
                                      </div>
                                      <div className="text-[9px] font-mono text-teal-800 tabular-nums">
                                        1 {PAYMENT_CURRENCY_LABELS[row.checkInPayment.currency]} ={" "}
                                        {row.checkInPayment.lockedRate.toFixed(4)} TL
                                      </div>
                                    </div>
                                  )}
                                  {effectiveLockedRates ? (
                                    <div
                                      className="mt-1.5 bg-emerald-50/80 border border-emerald-200 rounded px-2 py-1 text-left"
                                      title="Check-In tarihinde sabitlenen oda kuru (Check-Out sırasında kur farkı oluşmaz)"
                                    >
                                      <div className="flex items-center justify-between gap-2 text-[10px] font-extrabold text-emerald-900">
                                        <span className="inline-flex items-center gap-1">
                                          <Lock className="w-2.5 h-2.5 text-emerald-700" />
                                          <span>
                                            Giriş Kuru ({formatTrDate(effectiveLockedRates.lockedDate)})
                                          </span>
                                        </span>
                                        <span className="text-[9px] px-1 rounded bg-emerald-100 text-emerald-800">
                                          KUR FARKI YOK
                                        </span>
                                      </div>
                                      <div className="mt-0.5 font-mono text-[10px] text-emerald-800 tabular-nums">
                                        EUR {effectiveLockedRates.EUR.toFixed(4)} · USD{" "}
                                        {effectiveLockedRates.USD.toFixed(4)} · GBP{" "}
                                        {effectiveLockedRates.GBP.toFixed(4)}
                                      </div>
                                      {remaining > 0 && (
                                        <div className="mt-0.5 font-mono text-[10px] font-bold text-slate-800 tabular-nums">
                                          Kalan: {(remaining / effectiveLockedRates.EUR).toFixed(2)} € ·{" "}
                                          {(remaining / effectiveLockedRates.USD).toFixed(2)} $ ·{" "}
                                          {(remaining / effectiveLockedRates.GBP).toFixed(2)} £
                                        </div>
                                      )}
                                      {rateDiffersFromToday && (
                                        <div className="mt-0.5 text-[9px] font-semibold text-emerald-700">
                                          Güncel kur ({exchangeRates.EUR.toFixed(4)} /{" "}
                                          {exchangeRates.USD.toFixed(4)}) yerine Check-In kuru sabitlendi.
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div
                                      className="mt-1.5 bg-sky-50/70 border border-sky-200 rounded px-2 py-1 text-left"
                                      title="Aktif TCMB kuru üzerinden dinamik döviz karşılığı (Check-In anında sabitlenir)"
                                    >
                                      <div className="flex items-center justify-between gap-2 text-[10px] font-extrabold text-sky-900">
                                        <span>
                                          TCMB {activeRateType === "FOREX_BUYING" ? "Alış" : "Satış"} (
                                          {ratesMeta.bulletinDate || formatTrDate(systemToday)})
                                        </span>
                                        <span className="text-[9px] px-1 rounded bg-sky-100 text-sky-800">
                                          GÜNCEL KUR
                                        </span>
                                      </div>
                                      <div className="mt-0.5 font-mono text-[10px] text-sky-900 tabular-nums">
                                        {remaining > 0 ? "Kalan: " : "Total: "}
                                        {(
                                          (remaining > 0 ? remaining : row.totalAmount) /
                                          exchangeRates.EUR
                                        ).toFixed(2)}{" "}
                                        € ·{" "}
                                        {(
                                          (remaining > 0 ? remaining : row.totalAmount) /
                                          exchangeRates.USD
                                        ).toFixed(2)}{" "}
                                        $ ·{" "}
                                        {(
                                          (remaining > 0 ? remaining : row.totalAmount) /
                                          exchangeRates.GBP
                                        ).toFixed(2)}{" "}
                                        £
                                      </div>
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </td>

                          {/* Konaklama Durumu */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {row.lifecycle === "CONFIRMED" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-700 font-bold text-[11px]">
                                <Clock className="w-3 h-3 text-slate-500" />
                                BEKLENİYOR
                              </span>
                            )}
                            {row.lifecycle === "INHOUSE" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 border border-sky-300 text-sky-900 font-bold text-[11px]">
                                <BedDouble className="w-3 h-3 text-sky-700" />
                                INHOUSE {row.checkedInAt ? `(${row.checkedInAt})` : ""}
                              </span>
                            )}
                            {row.lifecycle === "CHECKED_OUT" && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-900 font-bold text-[11px]">
                                <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                                CHECKED OUT {row.checkedOutAt ? `(${row.checkedOutAt})` : ""}
                              </span>
                            )}
                            {row.lifecycle === "CANCELLED" && (
                              <div className="flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 border border-rose-300 text-rose-900 font-bold text-[11px] w-fit">
                                  <Ban className="w-3 h-3 text-rose-700" />
                                  İPTAL EDİLDİ {row.cancelledAt ? `(${row.cancelledAt})` : ""}
                                </span>
                                {row.cancellationReason && (
                                  <span
                                    title={row.cancellationReason}
                                    className="text-[10px] text-rose-700 font-medium max-w-[180px] truncate"
                                  >
                                    Neden: {row.cancellationReason}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* İşlem Butonları */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap no-print">
                            <div className="inline-flex items-center gap-1.5">
                              {/* DUE OUTS Ödeme Al & Check-Out */}
                              {activeModule === "DUE_OUTS" && row.lifecycle === "INHOUSE" && (
                                <>
                                  {remaining > 0 && (
                                    <div className="inline-flex items-center gap-1 bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5">
                                      <input
                                        type="number"
                                        min={0}
                                        max={remaining}
                                        value={dueInputVal}
                                        onChange={(e) =>
                                          setDueOutPaymentInputs((prev) => ({
                                            ...prev,
                                            [row.id]: e.target.value,
                                          }))
                                        }
                                        placeholder={`${remaining} TL`}
                                        className="w-20 px-1.5 py-0.5 text-xs font-mono font-bold bg-white border border-amber-300 rounded focus:outline-none"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setDueOutPaymentInputs((prev) => ({
                                            ...prev,
                                            [row.id]: String(remaining),
                                          }))
                                        }
                                        className="text-[10px] font-extrabold text-amber-900 hover:underline px-1 cursor-pointer"
                                        title="Kalan bakiyeyi otomatik doldur"
                                      >
                                        TAM
                                      </button>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    disabled={remaining - collectedNow > 0}
                                    onClick={() => handleCheckOut(row, collectedNow)}
                                    title={
                                      remaining - collectedNow > 0
                                        ? `BALANCE (${(remaining - collectedNow).toLocaleString("tr-TR")} TL) sıfır olmadan Check-Out yapılamaz`
                                        : "BALANCE: 0 TL — Check-Out Yap"
                                    }
                                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded font-extrabold text-[11px] ${
                                      remaining - collectedNow > 0
                                        ? "bg-slate-200 text-slate-500 cursor-not-allowed border border-slate-300"
                                        : "bg-amber-500 hover:bg-amber-600 text-amber-950 cursor-pointer"
                                    }`}
                                  >
                                    <LogOut className="w-3 h-3" />
                                    <span>
                                      {remaining - collectedNow > 0 ? "BALANCE > 0" : "CHECK-OUT"}
                                    </span>
                                  </button>
                                </>
                              )}

                              {activeModule === "DUE_OUTS" && row.lifecycle === "CHECKED_OUT" && (
                                <button
                                  type="button"
                                  onClick={() => handleUndoCheckOut(row)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-[11px] cursor-pointer"
                                >
                                  <Undo2 className="w-3 h-3" />
                                  <span>GERİ AL</span>
                                </button>
                              )}

                              {/* ARRIVALS & RESERVATION (Bugün Giriş) Check-In / Undo */}
                              {(activeModule === "ARRIVALS" ||
                                (activeModule === "RESERVATION" && row.checkIn <= systemToday)) &&
                                row.lifecycle === "CONFIRMED" && (
                                  <button
                                    type="button"
                                    onClick={() => handleCheckIn(row)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-[11px] cursor-pointer"
                                  >
                                    <LogIn className="w-3 h-3" />
                                    <span>CHECK-IN</span>
                                  </button>
                                )}

                              {activeModule === "RESERVATION" &&
                                row.lifecycle === "INHOUSE" &&
                                row.checkOut > systemToday && (
                                  <button
                                    type="button"
                                    onClick={() => openEarlyCheckOutModal(row)}
                                    title="Kalmadığı geceleri POST ederek erken çıkış işlemi başlat"
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-950 font-extrabold text-[11px] cursor-pointer"
                                  >
                                    <LogOut className="w-3 h-3" />
                                    <span>ERKEN ÇIKIŞ</span>
                                  </button>
                                )}

                              {activeModule === "ARRIVALS" && row.lifecycle === "INHOUSE" && (
                                <button
                                  type="button"
                                  onClick={() => handleUndoCheckIn(row)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-[11px] cursor-pointer"
                                >
                                  <Undo2 className="w-3 h-3" />
                                  <span>GERİ AL</span>
                                </button>
                              )}

                              {/* Ortak Kart Görüntüle / Düzenle */}
                              <button
                                type="button"
                                onClick={() =>
                                  setResModal({ isOpen: true, mode: "EDIT", target: row })
                                }
                                title="Rezervasyon Kartını Aç"
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>KART</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* MODÜL 3: INHOUSE / RACK (4 KAT x 5 ODA GÖRSEL ODA RACK'İ)        */}
        {/* ================================================================ */}
        {activeModule === "INHOUSE_RACK" && (
          <div className="flex flex-col gap-3">
            {/* Rack Filtre & Durum Özeti Çubuğu */}
            <div className="bg-[var(--pms-card-bg)] rounded-[var(--pms-radius)] border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3 no-print">
              <div className="flex items-center gap-2">
                <Grid className="w-4 h-4 text-sky-600" />
                <h1 className="text-sm font-extrabold text-slate-900 tracking-wide">
                  ODA RACK & HOUSEKEEPING DURUMU
                </h1>
                <span className="text-xs text-slate-500">
                  · Operasyon kartı için oda kartına çift tıklayın
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setRackFilter("ALL")}
                  className={`px-2.5 py-1 rounded text-xs font-bold border cursor-pointer ${
                    rackFilter === "ALL"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  TÜMÜ ({rooms.length})
                </button>
                {(
                  ["INHOUSE", "BOS", "DUE_OUT", "OUT_OF_ORDER", "CLOSED_TO_SALES"] as RackDisplayStatus[]
                ).map((st) => {
                  const cfg = RACK_STATUS_STYLES[st];
                  const active = rackFilter === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setRackFilter(st)}
                      className={`px-2.5 py-1 rounded text-xs font-bold border cursor-pointer transition-colors ${
                        active
                          ? "ring-2 ring-slate-900 ring-offset-1 " + cfg.badgeBg + " " + cfg.badgeText
                          : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                      }`}
                    >
                      {cfg.label} ({rackStats.counts[st]})
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setOnlyDirtyRack((prev) => !prev)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold border cursor-pointer ${
                    onlyDirtyRack
                      ? "bg-amber-400 border-amber-500 text-amber-950"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Sadece Kirli ({rackStats.dirtyCount})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOnlyLockedRack((prev) => !prev)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold border cursor-pointer ${
                    onlyLockedRack
                      ? "bg-rose-600 border-rose-700 text-white"
                      : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  <Lock className="w-3 h-3" />
                  <span>Sadece Kilitli ({rackStats.lockedCount})</span>
                </button>
              </div>
            </div>

            {/* 4 Katlı Oda Gridi */}
            <div className="flex flex-col gap-3">
              {[4, 3, 2, 1].map((floorNum) => {
                const floorRooms = rooms.filter((rm) => {
                  if (rm.floor !== floorNum) return false;
                  if (rackFilter !== "ALL" && getRackDisplayStatus(rm) !== rackFilter) return false;
                  if (onlyDirtyRack && !rm.isDirty) return false;
                  if (onlyLockedRack && !rm.isLocked) return false;
                  return true;
                });

                if (floorRooms.length === 0) return null;

                return (
                  <div
                    key={floorNum}
                    className="bg-[var(--pms-card-bg)] rounded-[var(--pms-radius)] border border-slate-200 p-3 flex flex-col gap-2.5"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                      <span className="text-xs font-extrabold text-slate-700 tracking-wide">
                        {floorNum}. KAT ODALARI
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        {floorRooms.length} Oda
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                      {floorRooms.map((room) => {
                        const rackSt = getRackDisplayStatus(room);
                        const style = RACK_STATUS_STYLES[rackSt];
                        const guest = reservations.find(
                          (r) => r.lifecycle === "INHOUSE" && r.roomNumber === room.roomNumber
                        );
                        const reqs = roomRequests[room.roomNumber];
                        const hasTeknik = Boolean(reqs?.teknik);
                        const hasHk = Boolean(reqs?.hk);
                        const hasResepsiyon = Boolean(reqs?.resepsiyon);

                        return (
                          <div
                            key={room.roomNumber}
                            onDoubleClick={() => handleOpenRackCard(room)}
                            className={`rounded-[var(--pms-radius)] border ${
                              tokens.density === "COMPACT" ? "p-3 gap-2" : "p-4 gap-3"
                            } flex flex-col justify-between select-none transition-transform hover:-translate-y-0.5 cursor-pointer ${style.cardBg} ${
                              room.isLocked
                                ? "border-rose-500 ring-2 ring-rose-400/50"
                                : style.cardBorder
                            }`}
                          >
                            {/* Üst satır: Oda no + Durum rozeti */}
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <div className="font-mono font-extrabold text-lg text-slate-900 leading-none">
                                    {room.roomNumber}
                                  </div>
                                  {room.isLocked && (
                                    <span
                                      title={`Kilitli (${room.lockedBy || "Otel Müdürü"})`}
                                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-600 text-white text-[9px] font-extrabold tracking-wide"
                                    >
                                      <Lock className="w-2.5 h-2.5" />
                                      <span>KİLİTLİ</span>
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] font-semibold text-slate-700 mt-1">
                                  {getCategoryName(room.categoryId)}
                                </div>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-extrabold tracking-wide whitespace-nowrap ${style.badgeBg} ${style.badgeText}`}
                              >
                                {style.label}
                              </span>
                            </div>

                            {/* Orta alan: Misafir bilgisi veya boş/kapalı açıklaması */}
                            <div className="min-h-[38px] text-xs flex flex-col gap-1.5">
                              {guest ? (
                                <>
                                  <div className="bg-white/75 rounded p-2 border border-black/5">
                                    <div className="font-extrabold text-slate-900 truncate">
                                      {guest.firstName} {guest.lastName}
                                    </div>
                                    <div className="text-[11px] text-slate-600 font-mono mt-0.5">
                                      Çıkış: {formatTrDate(guest.checkOut)}
                                    </div>
                                    {guest.extraCharges && guest.extraCharges.length > 0 && (
                                      <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-100 border border-indigo-300 text-[10px] font-extrabold text-indigo-900 font-mono tabular-nums">
                                        <Receipt className="w-2.5 h-2.5 text-indigo-700" />
                                        <span>
                                          POST: +
                                          {guest.extraCharges
                                            .reduce((s, c) => s + c.amount, 0)
                                            .toLocaleString("tr-TR")}{" "}
                                          TL ({guest.extraCharges.length})
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* BAĞIMSIZ BÖLÜM: CHECK-IN GÜNÜ ÖDEME (USD$ / Euro€ / TL + KİLİTLİ KUR) */}
                                  {(() => {
                                    const roomLockedRates = getEffectiveCheckInRatesForRes(guest);
                                    const savedPayment = guest.checkInPayment;
                                    const draft = rackPaymentDrafts[guest.id] ?? {
                                      amount: savedPayment ? savedPayment.amount.toFixed(2) : "",
                                      currency: savedPayment?.currency ?? ("USD" as PaymentCurrency),
                                    };
                                    const draftNum = Number(draft.amount) || 0;
                                    const selectedRate =
                                      draft.currency === "TRY"
                                        ? 1
                                        : roomLockedRates[draft.currency];
                                    const previewTl = Number((draftNum * selectedRate).toFixed(2));
                                    const isSavingThis = savingRackPaymentId === guest.id;
                                    const hasUnsavedChanges =
                                      Boolean(rackPaymentDrafts[guest.id]) &&
                                      (!savedPayment ||
                                        Math.abs(draftNum - savedPayment.amount) > 0.001 ||
                                        draft.currency !== savedPayment.currency);

                                    return (
                                      <div
                                        onClick={(e) => e.stopPropagation()}
                                        onDoubleClick={(e) => e.stopPropagation()}
                                        className="bg-white/95 rounded p-2 border border-emerald-300 shadow-2xs flex flex-col gap-1.5"
                                      >
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="text-[10px] font-extrabold text-emerald-950 tracking-wide">
                                            ÖDEME (CHECK-IN)
                                          </span>
                                          {savedPayment && !hasUnsavedChanges ? (
                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-800 text-[9px] font-extrabold">
                                              <Lock className="w-2.5 h-2.5" />
                                              <span>KAYITLI</span>
                                            </span>
                                          ) : (
                                            <span className="text-[9px] font-mono font-bold text-slate-500">
                                              {formatTrDate(roomLockedRates.lockedDate)}
                                            </span>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-1">
                                          <input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={draft.amount}
                                            onChange={(e) =>
                                              setRackPaymentDrafts((prev) => ({
                                                ...prev,
                                                [guest.id]: {
                                                  amount: e.target.value,
                                                  currency: draft.currency,
                                                },
                                              }))
                                            }
                                            placeholder="1200.00"
                                            aria-label={`Oda ${room.roomNumber} Check-In Ödeme Tutarı`}
                                            className="min-w-0 flex-1 border border-slate-300 rounded px-1.5 py-1 text-[11px] font-mono font-bold bg-white text-slate-900 tabular-nums focus:outline-none focus:border-emerald-600"
                                          />
                                          <select
                                            value={draft.currency}
                                            onChange={(e) =>
                                              setRackPaymentDrafts((prev) => ({
                                                ...prev,
                                                [guest.id]: {
                                                  amount: draft.amount,
                                                  currency: e.target.value as PaymentCurrency,
                                                },
                                              }))
                                            }
                                            aria-label={`Oda ${room.roomNumber} Ödeme Döviz Birimi`}
                                            className="w-[66px] shrink-0 border border-slate-300 rounded px-1 py-1 text-[11px] font-extrabold bg-white text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                                          >
                                            <option value="USD">USD$</option>
                                            <option value="EUR">Euro€</option>
                                            <option value="TRY">TL</option>
                                          </select>
                                          <button
                                            type="button"
                                            disabled={isSavingThis}
                                            onClick={() => void handleSaveRackCheckInPayment(guest)}
                                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-extrabold tracking-wide shrink-0 cursor-pointer"
                                          >
                                            {isSavingThis ? "..." : "KAYDET"}
                                          </button>
                                        </div>

                                        <div className="text-[10px] font-mono text-slate-600 tabular-nums">
                                          Giriş Kuru ({formatTrDate(roomLockedRates.lockedDate)}):{" "}
                                          <strong>
                                            1 {PAYMENT_CURRENCY_LABELS[draft.currency]} ={" "}
                                            {selectedRate.toFixed(4)} TL
                                          </strong>
                                        </div>

                                        {draftNum > 0 && (
                                          <div className="rounded bg-sky-50 border border-sky-200 px-1.5 py-1 text-[10px] font-mono text-sky-950 tabular-nums flex flex-col gap-0.5">
                                            <div className="flex items-center justify-between gap-1">
                                              <span>Alınan:</span>
                                              <strong>
                                                {formatForeignCurrencyValue(
                                                  draftNum,
                                                  draft.currency
                                                )}
                                              </strong>
                                            </div>
                                            <div className="flex items-center justify-between gap-1 text-emerald-900">
                                              <span>TL Karşılığı:</span>
                                              <strong>
                                                {previewTl.toLocaleString("tr-TR", {
                                                  minimumFractionDigits: 2,
                                                  maximumFractionDigits: 2,
                                                })}{" "}
                                                TL
                                              </strong>
                                            </div>
                                          </div>
                                        )}

                                        {savedPayment && (
                                          <div className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-1 text-[10px] text-emerald-950 flex flex-col gap-0.5">
                                            <div className="flex items-center justify-between gap-1 font-extrabold">
                                              <span className="inline-flex items-center gap-0.5">
                                                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-700" />
                                                <span>Kilitli Ödeme:</span>
                                              </span>
                                              <span className="font-mono tabular-nums">
                                                {formatForeignCurrencyValue(
                                                  savedPayment.amount,
                                                  savedPayment.currency
                                                )}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-1 font-mono tabular-nums text-emerald-900">
                                              <span>Check-In TL:</span>
                                              <strong>
                                                {savedPayment.tlAmount.toLocaleString("tr-TR", {
                                                  minimumFractionDigits: 2,
                                                  maximumFractionDigits: 2,
                                                })}{" "}
                                                TL
                                              </strong>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </>
                              ) : (
                                <div className="text-[11px] text-slate-600 italic pt-1">
                                  {rackSt === "OUT_OF_ORDER" && "Teknik bakım / arıza nedeniyle kapalı."}
                                  {rackSt === "CLOSED_TO_SALES" && "Satışa geçici olarak kapalı."}
                                  {rackSt === "BOS" && "Misafir girişine hazır."}
                                </div>
                              )}
                            </div>

                            {/* Alt satır: Kirli/Temiz + Departman not ikonları + İşlem butonu */}
                            <div className="flex items-center justify-between pt-1.5 border-t border-black/10">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleRoomDirty(room.roomNumber);
                                  }}
                                  title="Temiz / Kirli durumunu değiştir"
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-extrabold border cursor-pointer ${
                                    room.isDirty
                                      ? "bg-amber-200 border-amber-400 text-amber-950"
                                      : "bg-white/80 border-slate-300 text-emerald-800"
                                  }`}
                                >
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>{room.isDirty ? "KİRLİ" : "TEMİZ"}</span>
                                </button>

                                {hasTeknik && (
                                  <span
                                    title={`Teknik: ${reqs.teknik}`}
                                    className="p-1 rounded bg-rose-600 text-white"
                                  >
                                    <Wrench className="w-3 h-3" />
                                  </span>
                                )}
                                {hasHk && (
                                  <span
                                    title={`HK: ${reqs.hk}`}
                                    className="p-1 rounded bg-amber-500 text-amber-950"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                  </span>
                                )}
                                {hasResepsiyon && (
                                  <span
                                    title={`Resepsiyon: ${reqs.resepsiyon}`}
                                    className="p-1 rounded bg-sky-600 text-white"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleRoomLock(room.roomNumber, "Inhouse / Rack Kartı");
                                  }}
                                  title={
                                    room.isLocked
                                      ? "Oda kilidini aç (Yetkili Kullanıcı)"
                                      : "Odayı kilitle (Yetkili Kullanıcı)"
                                  }
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-extrabold cursor-pointer ${
                                    room.isLocked
                                      ? "bg-rose-600 border-rose-700 text-white hover:bg-rose-700"
                                      : "bg-white/80 border-slate-300 text-slate-700 hover:bg-white"
                                  }`}
                                >
                                  {room.isLocked ? (
                                    <>
                                      <Unlock className="w-2.5 h-2.5" />
                                      <span>Kilidi Aç</span>
                                    </>
                                  ) : (
                                    <>
                                      <Lock className="w-2.5 h-2.5" />
                                      <span>Kilitle</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setHistoryPanelRoomNumber(room.roomNumber);
                                  }}
                                  title="Room Status History"
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/80 hover:bg-white border border-slate-300 text-[10px] font-bold text-slate-700 cursor-pointer"
                                >
                                  <History className="w-3 h-3 text-sky-700" />
                                  <span>
                                    (
                                    {
                                      roomStatusLogs.filter(
                                        (l) => l.roomNumber === room.roomNumber
                                      ).length
                                    }
                                    )
                                  </span>
                                </button>
                                {guest && guest.checkOut > systemToday && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEarlyCheckOutModal(guest);
                                    }}
                                    title="Kalmadığı geceleri POST ederek Erken Çıkış yap"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 hover:bg-amber-200 border border-amber-300 text-[10px] font-extrabold text-amber-950 cursor-pointer"
                                  >
                                    <LogOut className="w-2.5 h-2.5" />
                                    <span>Erken Çıkış</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleOpenRackCard(room)}
                                  className="text-[11px] font-bold text-slate-800 hover:text-sky-700 underline cursor-pointer"
                                >
                                  Yönet
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* MODÜL 5: OCCUPANCY REPORT (AYLIK DOLULUK, GELİR & ADR ÖZETİ)     */}
        {/* ================================================================ */}
        {activeModule === "OCCUPANCY_REPORT" && (
          <OccupancyReport
            reservations={reservations}
            rooms={rooms}
            categories={categories}
            systemToday={systemToday}
          />
        )}

        {/* ================================================================ */}
        {/* MODÜL 6: END OF DAY (GÜN KAPAMA & GERİYE DÖNÜK RAPOR ARŞİVİ)      */}
        {/* ================================================================ */}
        {activeModule === "END_OF_DAY" && (
          <EndOfDayModule
            rooms={rooms}
            reservations={reservations}
            categories={categories}
            systemToday={systemToday}
            nextBusinessDate={nextBusinessDate}
            eodReports={eodReports}
            selectedReportId={selectedEodReportId}
            onSelectReport={setSelectedEodReportId}
            onExecuteEndOfDay={async () => {
              setEodSyncLog(null);
              setEodSyncError(null);
              setIsEodModalOpen(true);
            }}
            isClosingDay={isClosingDay}
          />
        )}
      </main>

      {/* ================================================================== */}
      {/* REZERVASYON OLUŞTURMA / DÜZENLEME MODALI                           */}
      {/* ================================================================== */}
      <ReservationCardModal
        key={resModal.target?.id || (resModal.isOpen ? "CREATE_NEW" : "CLOSED")}
        isOpen={resModal.isOpen}
        mode={resModal.mode}
        initialData={resModal.target}
        categories={categories}
        rooms={rooms}
        reservations={reservations}
        currentUserRole={currentUserRole}
        dailyRateLogs={dailyRateLogs}
        onRecordRateChange={handleRecordRateChange}
        onUpdateCategories={setCategories}
        defaultCheckInDate={systemToday}
        exchangeRates={exchangeRates}
        activeRateType={activeRateType}
        ratesBulletinDate={ratesMeta.bulletinDate || formatTrDate(systemToday)}
        onClose={() => setResModal({ isOpen: false, mode: "CREATE", target: null })}
        onSave={handleSaveReservation}
        onCancel={handleCancelReservation}
      />

      {/* ================================================================== */}
      {/* INHOUSE / RACK ODA OPERASYON KARTI MODALI                         */}
      {/* ================================================================== */}
      {activeRackRoom && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl border border-slate-300 w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shrink-0">
              <div className="flex items-center gap-2.5">
                <BedDouble className="w-4 h-4 text-sky-400" />
                <h2 className="font-bold text-sm tracking-wide">
                  ODA {activeRackRoom.roomNumber} OPERASYON KARTI —{" "}
                  {getCategoryName(activeRackRoom.categoryId)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRackModalRoomNumber(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4 text-xs overflow-y-auto">
              {/* Aktif Misafir Bilgisi */}
              {activeRackGuest ? (
                <>
                  <div className="p-3 rounded-md bg-sky-50 border border-sky-200 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold text-sky-700">KONAKLAYAN MİSAFİR</div>
                        <div className="text-sm font-extrabold text-slate-900">
                          {activeRackGuest.firstName} {activeRackGuest.lastName} (
                          {activeRackGuest.resCode})
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          {formatTrDate(activeRackGuest.checkIn)} —{" "}
                          {formatTrDate(activeRackGuest.checkOut)} ({activeRackGuest.nights} Gece)
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setRackModalRoomNumber(null);
                          setResModal({ isOpen: true, mode: "EDIT", target: activeRackGuest });
                        }}
                        className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-700 text-white font-bold cursor-pointer shrink-0"
                      >
                        Rezervasyon Kartı
                      </button>
                    </div>
                    {(() => {
                      const roomLockedRates: LockedExchangeRates =
                        activeRackGuest.checkInRates ?? {
                          ...DEFAULT_EXCHANGE_RATES,
                          lockedDate: activeRackGuest.checkIn,
                          bulletinDate: formatTrDate(activeRackGuest.checkIn),
                          source: "GİRİŞ SABİT",
                        };
                      return (
                        <div className="pt-2 border-t border-sky-200/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-900">
                          <span className="inline-flex items-center gap-1 font-bold">
                            <Lock className="w-3 h-3 text-emerald-700" />
                            <span>
                              Sabit Check-In Kuru ({formatTrDate(roomLockedRates.lockedDate)} ·{" "}
                              {roomLockedRates.source}) — Kur Farkı Yok
                            </span>
                          </span>
                          <span className="font-mono font-bold tabular-nums">
                            EUR {roomLockedRates.EUR.toFixed(4)} · USD {roomLockedRates.USD.toFixed(4)} · GBP{" "}
                            {roomLockedRates.GBP.toFixed(4)}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* CHECK-IN GÜNÜ ÖDEME BÖLÜMÜ (BAĞIMSIZ DÖVİZ / TL GİRİŞİ VE KİLİTLİ KUR KAYDI) */}
                  {(() => {
                    const roomLockedRates = getEffectiveCheckInRatesForRes(activeRackGuest);
                    const savedPayment = activeRackGuest.checkInPayment;
                    const draft = rackPaymentDrafts[activeRackGuest.id] ?? {
                      amount: savedPayment ? savedPayment.amount.toFixed(2) : "",
                      currency: savedPayment?.currency ?? ("USD" as PaymentCurrency),
                    };
                    const draftNum = Number(draft.amount) || 0;
                    const selectedRate =
                      draft.currency === "TRY" ? 1 : roomLockedRates[draft.currency];
                    const previewTl = Number((draftNum * selectedRate).toFixed(2));
                    const isSavingThis = savingRackPaymentId === activeRackGuest.id;

                    return (
                      <div className="p-3 rounded-md bg-emerald-50/70 border border-emerald-200 flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 font-extrabold text-emerald-950">
                            <Lock className="w-3.5 h-3.5 text-emerald-700" />
                            <span>
                              CHECK-IN GÜNÜ ÖDEME ({formatTrDate(roomLockedRates.lockedDate)} KURU
                              SABİT)
                            </span>
                          </div>
                          {savedPayment && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-extrabold">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>KAYITLI</span>
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-end gap-2">
                          <div className="flex-1 min-w-[140px]">
                            <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                              ÖDEME MİKTARI
                            </label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={draft.amount}
                              onChange={(e) =>
                                setRackPaymentDrafts((prev) => ({
                                  ...prev,
                                  [activeRackGuest.id]: {
                                    amount: e.target.value,
                                    currency: draft.currency,
                                  },
                                }))
                              }
                              placeholder="Örn: 1200.00"
                              className="w-full border border-emerald-300 rounded px-2.5 py-1.5 text-xs font-mono font-bold bg-white text-slate-900 tabular-nums focus:outline-none focus:border-emerald-600"
                            />
                          </div>

                          <div className="w-28">
                            <label className="block text-[11px] font-bold text-emerald-950 mb-1">
                              DÖVİZ CİNSİ
                            </label>
                            <select
                              value={draft.currency}
                              onChange={(e) =>
                                setRackPaymentDrafts((prev) => ({
                                  ...prev,
                                  [activeRackGuest.id]: {
                                    amount: draft.amount,
                                    currency: e.target.value as PaymentCurrency,
                                  },
                                }))
                              }
                              className="w-full border border-emerald-300 rounded px-2 py-1.5 text-xs font-extrabold bg-white text-slate-900 focus:outline-none focus:border-emerald-600 cursor-pointer"
                            >
                              <option value="USD">USD$</option>
                              <option value="EUR">Euro€</option>
                              <option value="TRY">TL</option>
                            </select>
                          </div>

                          <button
                            type="button"
                            disabled={isSavingThis}
                            onClick={() => void handleSaveRackCheckInPayment(activeRackGuest)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs tracking-wide cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>{isSavingThis ? "KAYDEDİLİYOR..." : "KAYDET"}</span>
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-white/90 border border-emerald-200 rounded px-2.5 py-1.5 font-mono tabular-nums">
                          <span>
                            Giriş Kuru ({formatTrDate(roomLockedRates.lockedDate)}):{" "}
                            <strong>
                              1 {PAYMENT_CURRENCY_LABELS[draft.currency]} ={" "}
                              {selectedRate.toFixed(4)} TL
                            </strong>
                          </span>
                          {draftNum > 0 && (
                            <span className="font-extrabold text-emerald-900">
                              {formatForeignCurrencyValue(draftNum, draft.currency)} ={" "}
                              {previewTl.toLocaleString("tr-TR", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{" "}
                              TL
                            </span>
                          )}
                        </div>

                        {savedPayment && (
                          <div className="text-[11px] font-semibold text-emerald-950 flex flex-wrap items-center justify-between gap-2 pt-0.5">
                            <span>
                              Kayıtlı Check-In Ödemesi:{" "}
                              <strong className="font-mono">
                                {formatForeignCurrencyValue(
                                  savedPayment.amount,
                                  savedPayment.currency
                                )}
                              </strong>{" "}
                              →{" "}
                              <strong className="font-mono">
                                {savedPayment.tlAmount.toLocaleString("tr-TR", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{" "}
                                TL
                              </strong>
                            </span>
                            <span className="text-[10px] text-emerald-800 font-mono">
                              {savedPayment.savedBy} · {savedPayment.savedAt}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ERKEN ÇIKIŞ (EARLY CHECK-OUT) BÖLÜMÜ — ÇIKIŞI İLERİ TARİHLİ INHOUSE ODALAR İÇİN */}
                  {activeRackGuest.checkOut > systemToday && (() => {
                    const earlyPreview = computeEarlyCheckOutPreview(activeRackGuest);
                    return (
                      <div className="p-3 rounded-md bg-amber-50 border border-amber-300 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-extrabold text-amber-950">
                            <LogOut className="w-4 h-4 text-amber-700 shrink-0" />
                            <span>ERKEN ÇIKIŞ (EARLY CHECK-OUT)</span>
                          </div>
                          <div className="text-[11px] text-amber-900 mt-0.5">
                            Planlı Çıkış: <b>{formatTrDate(activeRackGuest.checkOut)}</b> ·{" "}
                            <b>{earlyPreview.unusedNights}</b> kullanılmayan gece (+
                            {earlyPreview.unusedAccommodationTotal.toLocaleString("tr-TR")} TL POST).
                            Ödenen (<b>{earlyPreview.paidAmountFixed.toLocaleString("tr-TR")} TL</b>)
                            ve günlük ADR (<b>{earlyPreview.nightlyRate.toLocaleString("tr-TR")} TL</b>)
                            sabit kalır.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEarlyCheckOutModal(activeRackGuest)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-amber-950 font-extrabold text-xs tracking-wide shrink-0 cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>ERKEN ÇIKIŞ İŞLEMİ</span>
                        </button>
                      </div>
                    );
                  })()}

                  {/* POST — EKSTRA HİZMET & BEDEL EKLEME BÖLÜMÜ (AKTİF INHOUSE ODALAR İÇİN) */}
                  <div className="p-3 rounded-md bg-indigo-50/70 border border-indigo-200 flex flex-col gap-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-extrabold text-indigo-950">
                        <Receipt className="w-4 h-4 text-indigo-600" />
                        <span>POST — HİZMET &amp; BEDEL İŞLE</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
                        <span className="text-slate-600">
                          Ödenen:{" "}
                          <strong className="text-emerald-700">
                            {activeRackGuest.paidAmount.toLocaleString("tr-TR")} TL
                          </strong>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span className="text-slate-600">
                          Çıkışta Kalan:{" "}
                          <strong className="text-rose-700">
                            {Math.max(
                              0,
                              activeRackGuest.totalAmount - activeRackGuest.paidAmount
                            ).toLocaleString("tr-TR")}{" "}
                            TL
                          </strong>
                        </span>
                      </div>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handlePostRoomCharge(activeRackGuest, postServiceNote, postAmount);
                      }}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
                    >
                      <div className="sm:col-span-6">
                        <label className="block text-[11px] font-bold text-indigo-900 mb-1">
                          HİZMET - PORT (Not Alanı)
                        </label>
                        <input
                          type="text"
                          value={postServiceNote}
                          onChange={(e) => setPostServiceNote(e.target.value)}
                          placeholder="Örn: LAUNDRY HİZMETİ, Minibar, Oda Servisi..."
                          className="w-full border border-indigo-300 rounded px-2.5 py-1.5 text-xs font-semibold bg-white text-slate-900 focus:outline-none focus:border-indigo-600"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-bold text-indigo-900 mb-1">
                          BEDEL (TL)
                        </label>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={postAmount}
                          onChange={(e) => setPostAmount(e.target.value)}
                          placeholder="Örn: 2400"
                          className="w-full border border-indigo-300 rounded px-2.5 py-1.5 text-xs font-mono font-bold bg-white text-slate-900 focus:outline-none focus:border-indigo-600 tabular-nums"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <button
                          type="submit"
                          className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs tracking-wide cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>POST</span>
                        </button>
                      </div>
                    </form>

                    {/* Bu odaya eklenmiş POST kayıtları */}
                    {activeRackGuest.extraCharges && activeRackGuest.extraCharges.length > 0 && (
                      <div className="pt-2 border-t border-indigo-200 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px] font-bold text-indigo-900">
                          <span>
                            İŞLENMİŞ POST HİZMETLERİ ({activeRackGuest.extraCharges.length})
                          </span>
                          <span className="font-mono tabular-nums">
                            Toplam POST: +
                            {activeRackGuest.extraCharges
                              .reduce((s, c) => s + c.amount, 0)
                              .toLocaleString("tr-TR")}{" "}
                            TL
                          </span>
                        </div>
                        <div className="max-h-28 overflow-y-auto flex flex-col gap-1">
                          {activeRackGuest.extraCharges.map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-center justify-between gap-2 bg-white border border-indigo-200 rounded px-2.5 py-1.5"
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-slate-900 truncate">
                                  {entry.serviceNote}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {entry.postedBy} · {entry.postedAt}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono font-extrabold text-indigo-800 tabular-nums">
                                  +{entry.amount.toLocaleString("tr-TR")} TL
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRoomCharge(activeRackGuest, entry.id)}
                                  title="POST kaydını iptal et"
                                  className="p-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-slate-600 font-medium">
                  Bu odada şu anda konaklayan misafir bulunmuyor.
                </div>
              )}

              {/* Oda Kilidi (Room Lock) Kontrolü */}
              <div
                className={`p-3 rounded-md border flex flex-wrap items-center justify-between gap-2 ${
                  activeRackRoom.isLocked
                    ? "bg-rose-50 border-rose-300"
                    : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-start gap-2">
                  {activeRackRoom.isLocked ? (
                    <Lock className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  ) : (
                    <Unlock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-extrabold text-slate-900">
                      ODA KİLİDİ:{" "}
                      <span className={activeRackRoom.isLocked ? "text-rose-700" : "text-slate-700"}>
                        {activeRackRoom.isLocked ? "KİLİTLİ" : "AÇIK"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      {activeRackRoom.isLocked
                        ? `Kilitleyen: ${activeRackRoom.lockedBy || "Otel Müdürü"} (${activeRackRoom.lockedAt || ""}) — Resepsiyon oda tipi ve misafir bilgisini düzenleyemez.`
                        : "Yetkili kullanıcı (Otel Müdürü) odayı kilitleyerek resepsiyon değişikliklerini engelleyebilir."}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleToggleRoomLock(activeRackRoom.roomNumber, "Oda Operasyon Kartı")
                  }
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-extrabold text-xs cursor-pointer ${
                    activeRackRoom.isLocked
                      ? "bg-slate-900 hover:bg-slate-800 text-white"
                      : "bg-rose-600 hover:bg-rose-700 text-white"
                  }`}
                >
                  {activeRackRoom.isLocked ? (
                    <>
                      <Unlock className="w-3.5 h-3.5" />
                      <span>KİLİDİ AÇ</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5" />
                      <span>ODAYI KİLİTLE</span>
                    </>
                  )}
                </button>
              </div>

              {/* Fiziksel Durum ve Housekeeping Kontrolleri */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      handleSetRoomPhysicalStatus(activeRackRoom.roomNumber, "AVAILABLE")
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border cursor-pointer ${
                      activeRackRoom.physicalStatus === "AVAILABLE"
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-emerald-50 text-emerald-900 border-emerald-400 hover:bg-emerald-100"
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>
                      {activeRackRoom.physicalStatus === "OUT_OF_ORDER"
                        ? "SOLVED (SATIŞA AÇ)"
                        : "SATIŞA AÇIK (AVAILABLE)"}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleSetRoomPhysicalStatus(activeRackRoom.roomNumber, "OUT_OF_ORDER")
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border cursor-pointer ${
                      activeRackRoom.physicalStatus === "OUT_OF_ORDER"
                        ? "bg-slate-700 text-white border-slate-700"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    <Wrench className="w-3.5 h-3.5" />
                    <span>OUT OF ORDER</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleSetRoomPhysicalStatus(activeRackRoom.roomNumber, "CLOSED_TO_SALES")
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded font-bold border cursor-pointer ${
                      activeRackRoom.physicalStatus === "CLOSED_TO_SALES"
                        ? "bg-rose-600 text-white border-rose-600"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                    }`}
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>CLOSED TO SALES</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleRoomDirty(activeRackRoom.roomNumber)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded font-extrabold border cursor-pointer ${
                    activeRackRoom.isDirty
                      ? "bg-amber-400 border-amber-500 text-amber-950"
                      : "bg-emerald-50 border-emerald-300 text-emerald-800"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{activeRackRoom.isDirty ? "ODA KİRLİ (TEMİZLE)" : "ODA TEMİZ"}</span>
                </button>
              </div>

              {/* 3 Departman Talep Notu */}
              <div className="flex flex-col gap-3">
                {/* Teknik Servis */}
                <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-rose-600" />
                      <span>TEKNİK SERVİS NOTU</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleSaveRoomReq("teknik", draftTeknik)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                      >
                        <Save className="w-3 h-3" />
                        <span>Kaydet</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoomReq("teknik", true)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-900 font-bold text-[11px] cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>SOLVED</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoomReq("teknik")}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-[11px] cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Sil</span>
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={draftTeknik}
                    onChange={(e) => setDraftTeknik(e.target.value)}
                    placeholder="Klima, batarya, aydınlatma arızası vb."
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-sky-600"
                  />
                </div>

                {/* Housekeeping */}
                <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                      <span>HOUSEKEEPING (HK) NOTU</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleSaveRoomReq("hk", draftHk)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                      >
                        <Save className="w-3 h-3" />
                        <span>Kaydet</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoomReq("hk", true)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-900 font-bold text-[11px] cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>SOLVED</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoomReq("hk")}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-[11px] cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Sil</span>
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={draftHk}
                    onChange={(e) => setDraftHk(e.target.value)}
                    placeholder="Ekstra yastık, bebek yatağı, VIP setup vb."
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-sky-600"
                  />
                </div>

                {/* Resepsiyon */}
                <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-bold text-slate-800 flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-sky-600" />
                      <span>RESEPSİYON NOTU</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleSaveRoomReq("resepsiyon", draftResepsiyon)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                      >
                        <Save className="w-3 h-3" />
                        <span>Kaydet</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoomReq("resepsiyon", true)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-900 font-bold text-[11px] cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>SOLVED</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoomReq("resepsiyon")}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-[11px] cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Sil</span>
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={draftResepsiyon}
                    onChange={(e) => setDraftResepsiyon(e.target.value)}
                    placeholder="Uyandırma servisi, transfer talebi, geç çıkış vb."
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:border-sky-600"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setHistoryPanelRoomNumber(activeRackRoom.roomNumber)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-900 font-bold cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Room Status History</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRackModalRoomNumber(null)}
                  className="px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  KAPAT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* ROOM STATUS HISTORY YAN PANELİ                                     */}
      {/* ================================================================== */}
      <RoomStatusHistoryPanel
        roomNumber={historyPanelRoomNumber}
        rooms={rooms}
        categories={categories}
        logs={roomStatusLogs}
        onSelectRoom={(rmNo) => setHistoryPanelRoomNumber(rmNo)}
        onClose={() => setHistoryPanelRoomNumber(null)}
        onChangePhysicalStatus={handleSetRoomPhysicalStatus}
        onToggleDirty={handleToggleRoomDirty}
      />

      {/* ================================================================== */}
      {/* GUEST HISTORY YAN PANELİ                                           */}
      {/* ================================================================== */}
      <GuestHistoryPanel
        isOpen={guestHistoryOpen}
        initialQuery={guestHistoryQuery}
        reservations={reservations}
        categories={categories}
        onClose={() => setGuestHistoryOpen(false)}
        onOpenReservationCard={(res) =>
          setResModal({ isOpen: true, mode: "EDIT", target: res })
        }
      />

      {/* ================================================================== */}
      {/* HATA / ENGELLEME POP-UP MODALI                                     */}
      {/* ================================================================== */}
      {errorPopup && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center z-[70] p-4"
          onClick={() => setErrorPopup(null)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl border border-rose-300 w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-rose-600 text-white">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-white shrink-0" />
                <h2 className="font-extrabold text-xs tracking-wide uppercase">
                  {errorPopup.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setErrorPopup(null)}
                className="text-rose-100 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3 text-xs">
              <p className="text-slate-800 font-semibold leading-relaxed text-sm">
                {errorPopup.message}
              </p>

              {errorPopup.details && errorPopup.details.length > 0 && (
                <div className="p-3 rounded-md bg-rose-50 border border-rose-200 flex flex-col gap-1 text-rose-950 font-medium">
                  {errorPopup.details.map((line, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-slate-200">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setErrorPopup(null)}
                  className="px-5 py-2 rounded bg-rose-600 hover:bg-rose-700 text-white font-extrabold tracking-wide cursor-pointer"
                >
                  TAMAM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* END OF DAY (GÜNÜ KAPAT) ONAY VE TCMB KUR AKTARIM MODALI            */}
      {/* ================================================================== */}
      {isEodModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center z-[70] p-4"
          onClick={() => !isClosingDay && setIsEodModalOpen(false)}
        >
          <div
            className="bg-white rounded-[var(--pms-radius)] shadow-2xl border border-slate-300 w-full max-w-lg overflow-hidden text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-indigo-950 text-white">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-amber-400" />
                <h3 className="font-extrabold text-sm tracking-wide">
                  GÜN SONU İŞLEMİ (END OF DAY) &amp; TCMB KUR AKTARIMI
                </h3>
              </div>
              <button
                type="button"
                disabled={isClosingDay}
                onClick={() => setIsEodModalOpen(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="p-3 rounded bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="text-slate-500 block">Kapatılacak Sistem Tarihi:</span>
                  <span className="font-extrabold text-sm text-slate-900 font-mono">
                    {formatTrDate(systemToday)}
                  </span>
                </div>
                <CalendarArrowUp className="w-5 h-5 text-indigo-600" />
                <div className="text-right">
                  <span className="text-slate-500 block">Yeni Sistem Tarihi:</span>
                  <span className="font-extrabold text-sm text-emerald-700 font-mono">
                    {formatTrDate(nextBusinessDate)}
                  </span>
                </div>
              </div>

              {/* Gün Sonu Operasyon Kontrol Özeti */}
              {(moduleCounts.arrivalsPending > 0 || moduleCounts.dueOutsPending > 0) && (
                <div className="p-2.5 rounded bg-amber-50 border border-amber-300 text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Açık Gün Sonu Kalemleri Mevcut:</p>
                    <ul className="list-disc list-inside mt-0.5 text-[11px]">
                      {moduleCounts.arrivalsPending > 0 && (
                        <li>
                          Giriş yapmamış (No-Show adayı) {moduleCounts.arrivalsPending} rezervasyon var.
                        </li>
                      )}
                      {moduleCounts.dueOutsPending > 0 && (
                        <li>
                          Çıkış işlemi tamamlanmamış {moduleCounts.dueOutsPending} oda var.
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

              <p className="text-slate-600 leading-relaxed">
                <b>GÜNÜ KAPAT</b> onaylandığında sistem{" "}
                <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[11px]">
                  https://www.tcmb.gov.tr/kurlar/today.xml
                </code>{" "}
                adresinden güncel <b>USD, EUR ve GBP</b> alış/satış kurlarını otomatik çekerek PMS
                veritabanına kaydedecek ve yeni günün işlemlerini bu kurlar üzerinden hesaplayacaktır.{" "}
                <b className="text-emerald-800">
                  Halihazırda INHOUSE olan odaların Check-In kurları sabit kalmaya devam eder.
                </b>
              </p>

              {/* TCMB Aktarım Sonuç Bildirimi */}
              {eodSyncLog && (
                <div className="p-2.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-900 font-semibold flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{eodSyncLog}</span>
                </div>
              )}

              {eodSyncError && (
                <div className="p-2.5 rounded bg-rose-50 border border-rose-300 text-rose-900 font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{eodSyncError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  disabled={isClosingDay}
                  onClick={() => {
                    setActiveModule("END_OF_DAY");
                    setIsEodModalOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-bold text-indigo-900 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Gün Özeti &amp; Geçmiş Raporlar ({eodReports.length})</span>
                </button>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    disabled={isClosingDay}
                    onClick={() => setIsEodModalOpen(false)}
                    className="px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-100 font-bold text-slate-700 cursor-pointer"
                  >
                    KAPAT
                  </button>
                  <button
                    type="button"
                    disabled={isClosingDay}
                    onClick={() => void handleExecuteEndOfDay()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold tracking-wide shadow-xs cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isClosingDay ? "animate-spin" : ""}`} />
                    <span>
                      {isClosingDay ? "TCMB KURLARI ÇEKİLİYOR..." : "GÜNÜ KAPAT VE KURLARI AKTAR"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* END OF DAY — GÜN KAPAMASI TAMAMLANDI POP-UP MODALI                 */}
      {/* ================================================================== */}
      {eodCompletedPopup && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center z-[70] p-4"
          onClick={() => setEodCompletedPopup(null)}
        >
          <div
            className="bg-white rounded-[var(--pms-radius)] shadow-2xl border border-emerald-300 w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-600 text-white">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-white shrink-0" />
                <h2 className="font-extrabold text-xs tracking-wide uppercase">
                  GÜN KAPAMASI TAMAMLANDI
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEodCompletedPopup(null)}
                className="text-emerald-100 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3 text-xs">
              <p className="text-slate-800 font-semibold leading-relaxed text-sm">
                <b>{formatTrDate(eodCompletedPopup.closedDate)}</b> tarihine ait tüm gün sonu verileri kalıcı olarak kaydedildi.
              </p>

              <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 flex flex-col gap-1.5 text-emerald-950">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Kapatılan Gün:</span>
                  <span className="font-mono font-bold">{formatTrDate(eodCompletedPopup.closedDate)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Yeni Aktif PMS Günü:</span>
                  <span className="font-mono font-extrabold text-emerald-700">
                    {formatTrDate(eodCompletedPopup.nextDate)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-emerald-200/70">
                  <span className="text-slate-600 font-semibold">Doluluk / Gelir:</span>
                  <span className="font-mono font-bold">
                    {eodCompletedPopup.report.occupiedRooms}/{eodCompletedPopup.report.totalRooms} Oda (%
                    {eodCompletedPopup.report.occupancyRate}) ·{" "}
                    {(
                      eodCompletedPopup.report.roomRevenue +
                      eodCompletedPopup.report.extraChargesRevenue
                    ).toLocaleString("tr-TR")}{" "}
                    TL
                  </span>
                </div>
                {eodCompletedPopup.newDayTcmbTable && (
                  <div className="pt-1.5 border-t border-emerald-200/70 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 font-semibold">
                        Yeni Gün Kuru ({eodCompletedPopup.newDayRateSource || "TCMB"}):
                      </span>
                      <span className="text-[10px] font-mono text-emerald-800">
                        Bülten: {eodCompletedPopup.newDayBulletinDate || "—"}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] font-bold text-emerald-900 tabular-nums">
                      USD {eodCompletedPopup.newDayTcmbTable.USD.forexBuying.toFixed(4)} /{" "}
                      {eodCompletedPopup.newDayTcmbTable.USD.forexSelling.toFixed(4)} · EUR{" "}
                      {eodCompletedPopup.newDayTcmbTable.EUR.forexBuying.toFixed(4)} /{" "}
                      {eodCompletedPopup.newDayTcmbTable.EUR.forexSelling.toFixed(4)}
                    </div>
                    <div className="text-[10px] text-emerald-800 font-medium">
                      Mevcut INHOUSE odalar kendi Check-In kurlarında sabit tutulur.
                    </div>
                  </div>
                )}
              </div>

              {eodCompletedPopup.syncLog && (
                <div className="p-2.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-900 font-semibold flex items-start gap-2 text-[11px]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{eodCompletedPopup.syncLog}</span>
                </div>
              )}

              {eodCompletedPopup.syncError && (
                <div className="p-2.5 rounded bg-rose-50 border border-rose-300 text-rose-900 font-semibold flex items-start gap-2 text-[11px]">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{eodCompletedPopup.syncError}</span>
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-slate-200">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setEodCompletedPopup(null)}
                  className="px-5 py-2 rounded-[var(--pms-radius)] bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold tracking-wide cursor-pointer"
                >
                  TAMAM
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* ERKEN ÇIKIŞ (EARLY CHECK-OUT & GECELEME POST) MODALI               */}
      {/* ================================================================== */}
      {earlyCheckOutTarget && (() => {
        const currentTarget =
          reservations.find((r) => r.id === earlyCheckOutTarget.id) || earlyCheckOutTarget;
        const preview = computeEarlyCheckOutPreview(currentTarget);
        const extraCollectNum = Math.max(0, Number(earlyCheckOutCollectionInput) || 0);
        const simulatedPaid = Number((preview.paidAmountFixed + extraCollectNum).toFixed(2));
        const simulatedBalance = Math.max(0, preview.totalAfterPost - simulatedPaid);
        const canCompleteCheckout = simulatedBalance <= 0;

        return (
          <div className="fixed inset-0 z-50 bg-slate-900/65 flex items-center justify-center p-4 no-print">
            <div className="bg-white border border-amber-400 rounded-lg shadow-2xl w-full max-w-xl overflow-hidden">
              <div className="bg-amber-500 text-amber-950 px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-extrabold tracking-wide text-sm">
                  <LogOut className="w-4 h-4" />
                  <span>
                    ERKEN ÇIKIŞ — ODA {currentTarget.roomNumber || "Atanmadı"} (
                    {currentTarget.firstName} {currentTarget.lastName})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEarlyCheckOutTarget(null);
                    setEarlyCheckOutCollectionInput("");
                  }}
                  className="text-amber-950 hover:opacity-75 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 flex flex-col gap-3.5 text-xs">
                <div className="p-3 rounded-md bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-bold text-slate-500">
                      KONAKLAMA DEĞİŞİKLİĞİ
                    </div>
                    <div className="font-bold text-slate-900 mt-0.5">
                      {formatTrDate(currentTarget.checkIn)} →{" "}
                      <span className="line-through text-slate-400">
                        {formatTrDate(currentTarget.checkOut)}
                      </span>{" "}
                      <span className="text-amber-700 font-extrabold">
                        {formatTrDate(systemToday)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-[11px] text-slate-500">
                      Konaklanan: <b>{preview.effectiveStayedNights}</b> /{" "}
                      {preview.originalTotalNights} gece
                    </div>
                    <div className="text-[11px] font-extrabold text-amber-800">
                      Kalmadığı: {preview.unusedNights} gece
                    </div>
                  </div>
                </div>

                {/* ÖDEME, ADR VE BALANCE ÖZETİ */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="p-2.5 rounded border border-slate-200 bg-white">
                    <div className="text-[10px] font-bold text-slate-500">
                      GÜNLÜK ODA (ADR)
                    </div>
                    <div className="font-mono font-extrabold text-slate-900 mt-0.5 tabular-nums">
                      {preview.nightlyRate.toLocaleString("tr-TR")} TL
                    </div>
                    <div className="text-[9px] text-emerald-700 font-bold">Sabit Kalır</div>
                  </div>

                  <div className="p-2.5 rounded border border-emerald-200 bg-emerald-50/70">
                    <div className="text-[10px] font-bold text-emerald-800">
                      YAPILAN ÖDEME
                    </div>
                    <div className="font-mono font-extrabold text-emerald-950 mt-0.5 tabular-nums">
                      {preview.paidAmountFixed.toLocaleString("tr-TR")} TL
                    </div>
                    <div className="text-[9px] text-emerald-700 font-bold flex items-center gap-0.5">
                      <Lock className="w-2.5 h-2.5" />
                      <span>Değişmez</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded border border-indigo-200 bg-indigo-50/70">
                    <div className="text-[10px] font-bold text-indigo-800">
                      TOPLAM FOLYO
                    </div>
                    <div className="font-mono font-extrabold text-indigo-950 mt-0.5 tabular-nums">
                      {preview.totalAfterPost.toLocaleString("tr-TR")} TL
                    </div>
                    <div className="text-[9px] text-indigo-700 font-bold">
                      Oda + POST
                    </div>
                  </div>

                  <div
                    className={`p-2.5 rounded border ${
                      canCompleteCheckout
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-rose-300 bg-rose-50"
                    }`}
                  >
                    <div
                      className={`text-[10px] font-bold ${
                        canCompleteCheckout ? "text-emerald-800" : "text-rose-800"
                      }`}
                    >
                      BALANCE
                    </div>
                    <div
                      className={`font-mono font-extrabold mt-0.5 tabular-nums ${
                        canCompleteCheckout ? "text-emerald-900" : "text-rose-900"
                      }`}
                    >
                      {simulatedBalance.toLocaleString("tr-TR")} TL
                    </div>
                    <div
                      className={`text-[9px] font-extrabold ${
                        canCompleteCheckout ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      {canCompleteCheckout ? "Check-Out Açık" : "Check-Out Kilitli"}
                    </div>
                  </div>
                </div>

                {/* KALMADIĞI GECELERİN POST LİSTESİ */}
                {preview.unusedEntries.length > 0 ? (
                  <div className="p-3 rounded-md bg-indigo-50/60 border border-indigo-200 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px] font-extrabold text-indigo-950">
                      <span>
                        POST EDİLECEK KULLANILMAMIŞ GECELER ({preview.unusedEntries.length} gece)
                      </span>
                      <span className="font-mono tabular-nums">
                        +{preview.unusedAccommodationTotal.toLocaleString("tr-TR")} TL
                      </span>
                    </div>
                    <div className="max-h-32 overflow-y-auto flex flex-col gap-1">
                      {preview.unusedEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between bg-white border border-indigo-200 rounded px-2.5 py-1 text-[11px]"
                        >
                          <span className="font-bold text-slate-800">{entry.serviceNote}</span>
                          <span className="font-mono font-extrabold text-indigo-800 tabular-nums">
                            +{entry.amount.toLocaleString("tr-TR")} TL
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-slate-700 font-semibold">
                    Ekstra kullanılmayan gece POST kalemi oluşmuyor; Check-Out için BALANCE kontrolü uygulanır.
                  </div>
                )}

                {/* BALANCE > 0 İSE KİLİT UYARISI VE İSTEĞE BAĞLI TAHSİLAT */}
                {preview.balanceAfterPost > 0 && (
                  <div className="p-3 rounded-md bg-rose-50 border border-rose-200 flex flex-col gap-2">
                    <div className="flex items-start gap-2 text-rose-900 font-semibold">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>
                        Yapılan ödeme sabit tutulduğu için{" "}
                        <strong className="font-mono">
                          {preview.balanceAfterPost.toLocaleString("tr-TR")} TL
                        </strong>{" "}
                        BALANCE bulunmaktadır. <b>BALANCE sıfır olmadan Check-Out izni verilmez.</b>{" "}
                        İsterseniz önce kalmadığı geceleri POST edip ödemeyi DUE OUTS üzerinden alabilir
                        veya aşağıdan kalan bakiyeyi tahsil ederek çıkışı tamamlayabilirsiniz.
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <label className="text-[11px] font-bold text-rose-950">
                        Kalan Bakiye Tahsilatı (TL):
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={preview.balanceAfterPost}
                        value={earlyCheckOutCollectionInput}
                        onChange={(e) => setEarlyCheckOutCollectionInput(e.target.value)}
                        placeholder={`Örn: ${preview.balanceAfterPost}`}
                        className="w-32 px-2.5 py-1 text-xs font-mono font-bold bg-white border border-rose-300 rounded focus:outline-none focus:border-rose-600"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setEarlyCheckOutCollectionInput(String(preview.balanceAfterPost))
                        }
                        className="px-2 py-1 rounded bg-rose-200 hover:bg-rose-300 text-rose-950 text-[10px] font-extrabold cursor-pointer"
                      >
                        TAM ({preview.balanceAfterPost.toLocaleString("tr-TR")} TL)
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    disabled={isSubmittingEarlyCheckOut}
                    onClick={() => {
                      setEarlyCheckOutTarget(null);
                      setEarlyCheckOutCollectionInput("");
                    }}
                    className="px-3.5 py-2 rounded border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                  >
                    VAZGEÇ
                  </button>

                  {preview.unusedNights > 0 && currentTarget.checkOut > systemToday && (
                    <button
                      type="button"
                      disabled={isSubmittingEarlyCheckOut}
                      onClick={() => void handlePostUnusedNightsOnly(currentTarget)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold cursor-pointer"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>KALMADIĞI GECELERİ POST ET (ÖDEME SABİT)</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={!canCompleteCheckout || isSubmittingEarlyCheckOut}
                    onClick={() =>
                      void handleConfirmEarlyCheckOut(currentTarget, extraCollectNum)
                    }
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded font-extrabold tracking-wide ${
                      canCompleteCheckout && !isSubmittingEarlyCheckOut
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                    }`}
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>
                      {isSubmittingEarlyCheckOut
                        ? "İŞLENİYOR..."
                        : canCompleteCheckout
                          ? "POST ET & CHECK-OUT YAP"
                          : "BALANCE SIFIR OLMALI"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function StayFlowPmsApp() {
  return (
    <PmsThemeProvider>
      <StayFlowPmsInner />
    </PmsThemeProvider>
  );
}

