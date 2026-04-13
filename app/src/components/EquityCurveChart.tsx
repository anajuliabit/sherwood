"use client";

/**
 * EquityCurveChart — TVL over time with a time-window selector and an
 * optional USDC-lending benchmark overlay.
 *
 * The server passes the full available curve (typically 7D resolution from
 * the subgraph). We slice client-side for shorter windows and render a
 * flat benchmark line assuming a constant APY (4.5% default).
 */

import { useRef, useEffect, useState, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { Tabs } from "@/components/ui/Tabs";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
);

type WindowId = "7D" | "30D" | "90D" | "ALL";

interface EquityCurveChartProps {
  data: number[];
  hwm: string;
  /** Annualized benchmark APY (fraction, e.g. 0.045 = 4.5%). */
  benchmarkApy?: number;
  /** Disable benchmark overlay. */
  hideBenchmark?: boolean;
}

const WINDOWS: { id: WindowId; label: string; days: number | null }[] = [
  { id: "7D", label: "7D", days: 7 },
  { id: "30D", label: "30D", days: 30 },
  { id: "90D", label: "90D", days: 90 },
  { id: "ALL", label: "ALL", days: null },
];

export default function EquityCurveChart({
  data: rawData,
  hwm,
  benchmarkApy = 0.045,
  hideBenchmark = false,
}: EquityCurveChartProps) {
  const [windowId, setWindowId] = useState<WindowId>("7D");

  // Slice data to the selected window. If we don't have enough points,
  // fall back to whatever we have.
  const windowData = useMemo(() => {
    if (!rawData.length) return [0, 0];
    const win = WINDOWS.find((w) => w.id === windowId);
    const days = win?.days ?? rawData.length;
    const slice = rawData.slice(-days);
    return slice.length < 2 ? [slice[0] ?? 0, slice[0] ?? 0] : slice;
  }, [rawData, windowId]);

  // Build a flat benchmark growing at a constant daily rate.
  // Starts at the first windowData point so the curves begin together.
  const benchmarkData = useMemo(() => {
    if (hideBenchmark || windowData.length < 2) return null;
    const start = windowData[0] || 1;
    const dailyRate = benchmarkApy / 365;
    return windowData.map((_, i) => start * Math.pow(1 + dailyRate, i));
  }, [windowData, benchmarkApy, hideBenchmark]);

  const chartRef = useRef<ChartJS<"line">>(null);
  const [gradient, setGradient] = useState<CanvasGradient | string>(
    "rgba(46, 230, 166, 0.1)",
  );

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const ctx = chart.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, 300);
    g.addColorStop(0, "rgba(46, 230, 166, 0.15)");
    g.addColorStop(1, "rgba(46, 230, 166, 0)");
    setGradient(g);
  }, []);

  const labels = Array.from({ length: windowData.length }, (_, i) => i + 1);

  const datasets = [
    {
      label: "Vault NAV",
      data: windowData,
      borderColor: "#2EE6A6",
      borderWidth: 2,
      fill: true,
      backgroundColor: gradient,
      tension: 0.4,
      pointRadius: 0,
    },
  ];

  if (benchmarkData) {
    datasets.push({
      label: `USDC lending (${(benchmarkApy * 100).toFixed(1)}% APY)`,
      data: benchmarkData,
      borderColor: "rgba(232, 220, 192, 0.5)",
      borderWidth: 1,
      fill: false,
      backgroundColor: "transparent",
      tension: 0,
      pointRadius: 0,
      // @ts-expect-error chart.js accepts borderDash but types are loose in the types we register
      borderDash: [4, 4],
    });
  }

  return (
    <div className="chart-container">
      <div className="panel-title font-[family-name:var(--font-plus-jakarta)]">
        <span>Equity Curve</span>
        <span style={{ color: "var(--color-accent)" }}>HWM: {hwm}</span>
      </div>

      <div style={{ margin: "0.5rem 0 1rem" }}>
        <Tabs
          items={WINDOWS.map((w) => ({ id: w.id, label: w.label }))}
          active={windowId}
          onChange={setWindowId}
          ariaLabel="Chart time window"
        />
      </div>

      <div style={{ height: "280px", width: "100%" }}>
        <Line
          ref={chartRef}
          data={{ labels, datasets }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                enabled: true,
                callbacks: {
                  label: (ctx) => {
                    const v = ctx.parsed?.y ?? 0;
                    const prefix = ctx.dataset.label ? `${ctx.dataset.label}: ` : "";
                    if (v === 0) return `${prefix}0`;
                    if (Math.abs(v) < 0.01) return `${prefix}${v.toPrecision(4)}`;
                    return `${prefix}${v.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
                  },
                },
              },
            },
            scales: {
              x: { display: false },
              y: {
                grid: { color: "rgba(255,255,255,0.05)" },
                ticks: {
                  callback: (value) => {
                    const v = Number(value);
                    if (v === 0) return "0";
                    if (Math.abs(v) < 0.01) return v.toPrecision(4);
                    return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
                  },
                  color: "rgba(255,255,255,0.3)",
                  font: { size: 10, family: "Plus Jakarta Sans" },
                },
              },
            },
          }}
        />
      </div>

      {benchmarkData && (
        <div
          style={{
            marginTop: "0.75rem",
            display: "flex",
            gap: "1.25rem",
            alignItems: "center",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.05em",
            color: "var(--color-fg-secondary)",
          }}
        >
          <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
            <span style={{ display: "inline-block", width: 14, height: 2, background: "#2EE6A6" }} />
            Vault NAV
          </span>
          <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 1,
                borderTop: "1px dashed rgba(232,220,192,0.5)",
              }}
            />
            USDC lending @ {(benchmarkApy * 100).toFixed(1)}% APY (reference)
          </span>
        </div>
      )}
    </div>
  );
}
