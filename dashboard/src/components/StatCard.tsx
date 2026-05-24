import React from "react";
import clsx from "clsx";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: "default" | "green" | "red" | "yellow" | "blue";
  icon?: React.ReactNode;
}

const colorMap = {
  default: "text-white",
  green: "text-emerald-400",
  red: "text-red-400",
  yellow: "text-yellow-400",
  blue: "text-blue-400",
};

export function StatCard({ label, value, sub, color = "default", icon }: StatCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
          <p className={clsx("text-2xl font-bold", colorMap[color])}>{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        {icon && (
          <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center text-gray-400">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
