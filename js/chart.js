/* ============================================================
   chart.js — hourly time-series aggregation + Chart.js render
   Every telemetry sample is folded into an hour bucket; the
   chart shows the 24-hour rolling average of soil % and temp.
   ============================================================ */

(function () {
  class TrendChart {
    constructor(canvasId, historyHours) {
      this.historyHours = historyHours || 24;
      this.buckets = {}; // hourMs -> { soilSum, soilCount, tempSum, tempCount, samples }
      this.chart = this._build(canvasId);
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
              label: "Suhu \u00b0C",
              data: [],
              yAxisID: "yTemp",
              borderColor: "#38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.1)",
              fill: false,
              tension: 0.35,
              spanGaps: true,
              pointRadius: 3,
              pointBackgroundColor: "#38bdf8",
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
            yTemp: {
              position: "right",
              grid: { drawOnChartArea: false },
              ticks: { color: "#38bdf8", callback: (v) => v + "\u00b0" },
            },
          },
        },
      });
    }

    // Fold one reading into its hour bucket.
    record(soil, temp) {
      const hour = Math.floor(Date.now() / 3600000) * 3600000;
      const b = this.buckets[hour] || { soilSum: 0, soilCount: 0, tempSum: 0, tempCount: 0, samples: 0 };
      if (soil != null) {
        b.soilSum += soil;
        b.soilCount++;
      }
      if (temp != null) {
        b.tempSum += temp;
        b.tempCount++;
      }
      b.samples++;
      this.buckets[hour] = b;

      // Drop buckets outside the retention window.
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

      const labels = hours.map((h) =>
        new Date(h).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
      );
      const soil = hours.map((h) => {
        const b = this.buckets[h];
        return b.soilCount ? Math.round((b.soilSum / b.soilCount) * 10) / 10 : null;
      });
      const temp = hours.map((h) => {
        const b = this.buckets[h];
        return b.tempCount ? Math.round((b.tempSum / b.tempCount) * 10) / 10 : null;
      });

      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = soil;
      this.chart.data.datasets[1].data = temp;
      this.chart.update();
    }

    get isEmpty() {
      return Object.keys(this.buckets).length === 0;
    }
  }

  window.TrendChart = TrendChart;
})();
