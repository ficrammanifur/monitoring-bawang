/* ============================================================
   chart.js — hourly time-series aggregation + Chart.js render
   Every telemetry sample is folded into an hour bucket
   ============================================================ */

(function () {
  class TrendChart {
    constructor(canvasId, historyHours) {
      this.historyHours = historyHours || 24;
      this.buckets = {};
      this.chart = this._build(canvasId);
      this.thresholdOn = 45;
      this.thresholdOff = 65;
    }

    setThresholds(on, off) {
      this.thresholdOn = on;
      this.thresholdOff = off;
      this._render();
    }

    _build(canvasId) {
      const ctx = document.getElementById(canvasId).getContext("2d");
      const grid = "rgba(44, 71, 56, 0.6)";
      const tick = "#93ad9d";

      return new Chart(ctx, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Soil %",
              data: [],
              yAxisID: "ySoil",
              borderColor: "#4ade80",
              backgroundColor: "rgba(74, 222, 128, 0.15)",
              fill: true,
              tension: 0.35,
              spanGaps: true,
              pointRadius: 3,
              pointBackgroundColor: "#4ade80",
            },
            {
              label: "Threshold ON",
              data: [],
              yAxisID: "ySoil",
              borderColor: "rgba(251, 191, 36, 0.6)",
              borderDash: [6, 4],
              borderWidth: 2,
              fill: false,
              tension: 0,
              pointRadius: 0,
              spanGaps: true,
            },
            {
              label: "Threshold OFF",
              data: [],
              yAxisID: "ySoil",
              borderColor: "rgba(248, 113, 113, 0.6)",
              borderDash: [6, 4],
              borderWidth: 2,
              fill: false,
              tension: 0,
              pointRadius: 0,
              spanGaps: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#1b2f25",
              borderColor: "#2c4738",
              borderWidth: 1,
              titleColor: "#eaf3ec",
              bodyColor: "#eaf3ec",
              padding: 10,
            },
          },
          scales: {
            x: {
              grid: { color: grid },
              ticks: { color: tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            },
            ySoil: {
              position: "left",
              min: 0,
              max: 100,
              grid: { color: grid },
              ticks: { color: "#4ade80", callback: (v) => v + "%" },
            },
          },
        },
      });
    }

    record(soil, temp) {
      const hour = Math.floor(Date.now() / 3600000) * 3600000;
      const b = this.buckets[hour] || { soilSum: 0, soilCount: 0, tempSum: 0, tempCount: 0 };

      if (soil != null) {
        b.soilSum += soil;
        b.soilCount++;
      }
      if (temp != null) {
        b.tempSum += temp;
        b.tempCount++;
      }

      this.buckets[hour] = b;

      // Drop old buckets
      const cutoff = hour - (this.historyHours - 1) * 3600000;
      Object.keys(this.buckets).forEach((k) => {
        if (Number(k) < cutoff) delete this.buckets[k];
      });

      this._render();
    }

    _render() {
      const hours = Object.keys(this.buckets)
        .map(Number)
        .sort((a, b) => a - b);

      if (hours.length === 0) return;

      const labels = hours.map((h) =>
        new Date(h).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
      );

      const soil = hours.map((h) => {
        const b = this.buckets[h];
        return b.soilCount ? Math.round((b.soilSum / b.soilCount) * 10) / 10 : null;
      });

      // Threshold lines
      const onLine = hours.map(() => this.thresholdOn);
      const offLine = hours.map(() => this.thresholdOff);

      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = soil;
      this.chart.data.datasets[1].data = onLine;
      this.chart.data.datasets[2].data = offLine;
      this.chart.update();
    }

    get isEmpty() {
      return Object.keys(this.buckets).length === 0;
    }
  }

  window.TrendChart = TrendChart;
})();
