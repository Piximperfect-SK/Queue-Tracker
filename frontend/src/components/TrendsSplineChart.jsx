import React, { useEffect, useState } from 'react';
import Chart from 'react-apexcharts';
import { motion } from 'framer-motion';
import { formatCurrency } from '../utils/formatCurrency';
import { format, parseISO } from 'date-fns';

const TrendsSplineChart = ({ data = [], loading, compact = false }) => {
  const [isDarkMode, setIsDarkMode] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  );
  // Chart control states
  const [showGrid, setShowGrid] = useState(true);
  const [showXLabels, setShowXLabels] = useState(true);
  const [showYLabels, setShowYLabels] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [yStartAtZero, setYStartAtZero] = useState(false);

  useEffect(() => {
    const updateTheme = () => setIsDarkMode(document.documentElement.getAttribute('data-theme') === 'dark');
    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  if (loading) {
    return (
      <div className="glass-panel p-6 flex items-center justify-center h-full">
        <div className="animate-pulse text-slate-400 font-medium">Loading Analytics...</div>
      </div>
    );
  }

  const safeData = Array.isArray(data) ? data : [];

  const categories = safeData.map(item => {
    try {
      return format(parseISO(item.day), 'dd MMM');
    } catch (e) {
      return 'Unknown';
    }
  });

  // Sanitize: ApexCharts SVG path renderer breaks on scientific notation
  // (e.g. 1.673e+15 or 3.487e-2). Round to whole rupees — sufficient for
  // currency charts and guarantees plain integers go into the SVG path.
  const sanitize = (val) => {
    const n = Number(val);
    if (!isFinite(n) || isNaN(n)) return 0;
    return Math.round(n);
  };

  const series = [
    {
      name: 'Income',
      data: safeData.map(item => sanitize(item.income))
    },
    {
      name: 'Expense',
      data: safeData.map(item => sanitize(item.expense))
    }
  ];

  const options = {
    chart: {
      type: 'area',
      foreColor: isDarkMode ? '#ffffff' : '#0f172a',
      toolbar: { show: false },
      zoom: { enabled: false },
      fontFamily: 'inherit',
      sparkline: { enabled: compact },
      animations: {
        enabled: true,
        easing: 'easeinout',
        speed: 800,
      }
    },
    dataLabels: { enabled: false },
    stroke: {
      curve: 'smooth',
      width: compact ? 2 : 3,
      lineCap: 'round'
    },
    colors: ['#10b981', '#ef4444'],
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.45,
        opacityTo: 0.05,
        stops: [20, 100]
      }
    },
    grid: {
      show: showGrid,
      borderColor: isDarkMode ? 'rgba(148,163,184,0.32)' : 'rgba(148,163,184,0.28)',
      strokeDashArray: 4,
      xaxis: { lines: { show: showGrid } },
      yaxis: { lines: { show: showGrid } },
      padding: {
        top: compact ? 0 : 20,
        right: 20,
        bottom: compact ? 20 : 40,
        left: 20
      }
    },
    xaxis: {
      categories: categories,
      axisBorder: { show: showXLabels, color: isDarkMode ? 'rgba(148,163,184,0.32)' : 'rgba(148,163,184,0.28)' },
      axisTicks: { show: showXLabels, color: isDarkMode ? 'rgba(148,163,184,0.32)' : 'rgba(148,163,184,0.28)' },
      labels: {
        show: showXLabels,
        style: {
          colors: isDarkMode ? '#ffffff' : '#0f172a',
          fontSize: compact ? '8px' : '10px'
        },
        rotate: compact ? 0 : -45,
        rotateAlways: false,
        hideOverlappingLabels: true,
        trim: true,
      },
      tickAmount: compact ? 3 : 10
    },
    yaxis: {
      show: showYLabels && !compact,
      labels: {
        show: showYLabels && !compact,
        formatter: (val) => formatCurrency(val),
        style: {
          colors: isDarkMode ? '#ffffff' : '#0f172a',
          fontSize: '10px'
        }
      },
      tickAmount: 5,
      min: yStartAtZero ? 0 : undefined,
    },
    tooltip: {
      theme: isDarkMode ? 'dark' : 'light',
      y: {
        formatter: (val) => formatCurrency(val)
      },
      marker: { show: true },
    },
    legend: {
      show: showLegend && !compact,
      position: 'top',
      horizontalAlign: 'right',
      fontSize: '12px',
      markers: { radius: 12 },
      labels: { colors: isDarkMode ? '#ffffff' : '#0f172a' }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col h-full ${compact ? 'p-3' : 'p-4'}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className={`${compact ? 'text-base' : 'text-lg'} font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'} tracking-tight`}>
            Monthly Performance
          </h2>
          {!compact && (
            <p className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-slate-500'} uppercase tracking-widest mt-1`}>
              Daily Cash Flow
            </p>
          )}
        </div>
        {!compact && (
          <div className="ml-4">
            <details className="relative">
              <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">Chart Controls</summary>
              <div className="absolute right-0 mt-2 w-56 p-3 bg-white border rounded-lg shadow-lg z-10">
                <label className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-700">Show Grid</span>
                  <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
                </label>
                <label className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-700">Show X Labels</span>
                  <input type="checkbox" checked={showXLabels} onChange={(e) => setShowXLabels(e.target.checked)} />
                </label>
                <label className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-700">Show Y Labels</span>
                  <input type="checkbox" checked={showYLabels} onChange={(e) => setShowYLabels(e.target.checked)} />
                </label>
                <label className="flex items-center justify-between mb-2">
                  <span className="text-sm text-slate-700">Show Legend</span>
                  <input type="checkbox" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-sm text-slate-700">Y-axis starts at 0</span>
                  <input type="checkbox" checked={yStartAtZero} onChange={(e) => setYStartAtZero(e.target.checked)} />
                </label>
              </div>
            </details>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 w-full">
        <Chart
          options={options}
          series={series}
          type="area"
          height="100%"
          width="100%"
        />
      </div>
    </motion.div>
  );
};

export default TrendsSplineChart;
