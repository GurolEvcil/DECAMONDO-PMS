import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TcmbRateItem {
  code: "TRY" | "USD" | "EUR" | "GBP";
  name: string;
  forexBuying: number;
  forexSelling: number;
}

interface TcmbRatesPayload {
  success: boolean;
  source: string;
  bulletinDate: string;
  fetchedAt: string;
  rates: Record<"TRY" | "USD" | "EUR" | "GBP", TcmbRateItem>;
}

function extractCurrencyRates(
  xml: string,
  code: "USD" | "EUR" | "GBP",
  defaultName: string
): TcmbRateItem | null {
  const blockRegex = new RegExp(
    `<Currency[^>]*CurrencyCode="${code}"[^>]*>([\\s\\S]*?)<\\/Currency>`,
    "i"
  );
  const blockMatch = xml.match(blockRegex);
  if (!blockMatch) return null;

  const block = blockMatch[1];
  const unitMatch = block.match(/<Unit>\s*([\d.]+)\s*<\/Unit>/i);
  const unit = unitMatch ? Number(unitMatch[1]) || 1 : 1;

  const isimMatch = block.match(/<Isim>\s*([^<]+?)\s*<\/Isim>/i);
  const buyingMatch = block.match(/<ForexBuying>\s*([\d.,]+)\s*<\/ForexBuying>/i);
  const sellingMatch = block.match(/<ForexSelling>\s*([\d.,]+)\s*<\/ForexSelling>/i);

  const rawBuying = buyingMatch?.[1] || sellingMatch?.[1];
  const rawSelling = sellingMatch?.[1] || buyingMatch?.[1];
  if (!rawBuying || !rawSelling) return null;

  const parsedBuying = Number(rawBuying.replace(",", "."));
  const parsedSelling = Number(rawSelling.replace(",", "."));
  if (
    !Number.isFinite(parsedBuying) ||
    parsedBuying <= 0 ||
    !Number.isFinite(parsedSelling) ||
    parsedSelling <= 0
  ) {
    return null;
  }

  return {
    code,
    name: (isimMatch?.[1] || defaultName).trim().slice(0, 64),
    forexBuying: Number((parsedBuying / unit).toFixed(4)),
    forexSelling: Number((parsedSelling / unit).toFixed(4)),
  };
}

async function fetchTcmbTodayRates(): Promise<TcmbRatesPayload> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", {
      signal: controller.signal,
      headers: {
        "User-Agent": "StayFlowPMS/1.0 (+TCMB-Kur-Entegrasyonu)",
        Accept: "application/xml, text/xml, */*",
      },
    });

    if (!response.ok) {
      throw new Error(`TCMB HTTP ${response.status}`);
    }

    const xml = await response.text();
    const dateMatch = xml.match(/<Tarih_Date[^>]*Tarih="([^"]+)"/i);
    const bulletinDate = dateMatch?.[1] || new Date().toLocaleDateString("tr-TR");

    const usd = extractCurrencyRates(xml, "USD", "ABD DOLARI");
    const eur = extractCurrencyRates(xml, "EUR", "EURO");
    const gbp = extractCurrencyRates(xml, "GBP", "İNGİLİZ STERLİNİ");

    if (!usd || !eur || !gbp) {
      throw new Error("TCMB XML yanıtında USD/EUR/GBP alış/satış kurları bulunamadı.");
    }

    return {
      success: true,
      source: "TCMB",
      bulletinDate,
      fetchedAt: new Date().toISOString(),
      rates: {
        TRY: { code: "TRY", name: "TÜRK LİRASI", forexBuying: 1, forexSelling: 1 },
        USD: usd,
        EUR: eur,
        GBP: gbp,
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json());

  app.get("/api/tcmb-rates", async (_req, res) => {
    try {
      const payload = await fetchTcmbTodayRates();
      res.json(payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "TCMB kur servisine ulaşılamadı.";
      res.status(502).json({
        success: false,
        error: message,
        source: "TCMB_UNAVAILABLE",
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(port, "0.0.0.0", () => {
    console.log(`StayFlow PMS server running on http://0.0.0.0:${port}`);
  });
}

startServer();
